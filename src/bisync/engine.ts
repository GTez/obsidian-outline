/**
 * Top-level bidirectional sync engine.
 *
 * One method per user-facing operation. The engine owns the local index,
 * resolves Outline IDs, walks subtrees, drives the reconciler, and saves
 * state. Plugin code talks to *this* — never to the individual modules.
 */

import { nanoid } from './nanoid';
import { parseSourceRef } from './url-parser';
import { walkCollection, walkDocument } from './walker';
import { LocalIndex } from './local-index';
import type { IndexStorage } from './local-index';
import { reconcileMapping, type ReconcileEvent } from './reconciler';
import type { OutlineNode } from './hierarchy';
import type { IOutlineApi } from '../outline-api/types';
import type { OutlineSyncSettings, SyncMapping } from '../settings';
import type { VaultIO } from './vault-io';
import { getOutlineMeta, type OutlineFrontmatter } from '../pipeline';

export interface SyncMappingResult {
  mappingId: string;
  ok: boolean;
  events: ReconcileEvent[];
  error?: string;
}

export interface BisyncEngineOptions {
  api: IOutlineApi;
  vault: VaultIO;
  indexStorage: IndexStorage;
  /** Live settings reference — re-read on each operation so reconfigures take effect. */
  getSettings: () => OutlineSyncSettings;
  log?: (msg: string) => void;
}

export class BisyncEngine {
  private readonly api: IOutlineApi;
  private readonly vault: VaultIO;
  private readonly indexStorage: IndexStorage;
  private readonly getSettings: () => OutlineSyncSettings;
  private readonly log: (msg: string) => void;
  private index: LocalIndex | null = null;
  private syncInFlight: Promise<unknown> | null = null;

  constructor(opts: BisyncEngineOptions) {
    this.api = opts.api;
    this.vault = opts.vault;
    this.indexStorage = opts.indexStorage;
    this.getSettings = opts.getSettings;
    this.log = opts.log ?? (() => undefined);
  }

  /** Run all enabled mappings, serialized to avoid concurrent API hammering. */
  async syncAll(): Promise<SyncMappingResult[]> {
    return this.runExclusive(async () => {
      const results: SyncMappingResult[] = [];
      for (const mapping of this.getSettings().mappings) {
        if (!mapping.enabled) continue;
        results.push(await this.runMapping(mapping));
      }
      await this.ensureIndex().then((idx) => idx.save(this.indexStorage));
      return results;
    });
  }

  async syncMappingById(mappingId: string): Promise<SyncMappingResult | null> {
    const mapping = this.getSettings().mappings.find((m) => m.id === mappingId);
    if (!mapping) return null;
    return this.runExclusive(async () => {
      const res = await this.runMapping(mapping);
      await this.ensureIndex().then((idx) => idx.save(this.indexStorage));
      return res;
    });
  }

  /**
   * Resolve a user-supplied source ref against Outline and return enough
   * metadata to build a SyncMapping. Returns null if it can't be resolved.
   */
  async resolveSource(input: string): Promise<
    | {
        type: 'document' | 'collection';
        outlineId: string;
        displayName: string;
      }
    | null
  > {
    const parsed = parseSourceRef(input);
    if (!parsed) return null;
    // Try document first if hint says so or unknown; fall back to collection.
    const tryDoc = parsed.typeHint !== 'collection';
    const tryColl = parsed.typeHint !== 'document';
    if (tryDoc) {
      const doc = await this.api.getDocument(parsed.identifier);
      if (doc?.id) {
        return { type: 'document', outlineId: doc.id, displayName: doc.title ?? 'Untitled' };
      }
    }
    if (tryColl) {
      const coll = await this.api.getCollection(parsed.identifier);
      if (coll?.id) {
        return { type: 'collection', outlineId: coll.id, displayName: coll.name ?? 'Untitled' };
      }
    }
    return null;
  }

  /** Build a SyncMapping object with a fresh internal id. */
  buildMapping(input: {
    type: 'document' | 'collection';
    outlineId: string;
    displayName: string;
    vaultPath: string;
    includeRoot: boolean;
  }): SyncMapping {
    return {
      id: nanoid(),
      source: {
        type: input.type,
        outlineId: input.outlineId,
        displayName: input.displayName,
        lastResolvedAt: new Date().toISOString(),
      },
      vaultPath: input.vaultPath.replace(/^\/+|\/+$/g, ''),
      includeRoot: input.includeRoot,
      enabled: true,
      lastFullSyncAt: null,
    };
  }

  /** Rebuild the local index from scratch by walking vault frontmatter. */
  async rebuildIndex(): Promise<void> {
    const idx = LocalIndex.empty();
    for (const mapping of this.getSettings().mappings) {
      const paths = await this.vault.listMarkdown(mapping.vaultPath);
      for (const path of paths) {
        const raw = await this.vault.read(path);
        const meta = parseFromRaw(raw);
        if (!meta.outline_id || meta.conflict_for) continue;
        if (meta.outline_mapping_id && meta.outline_mapping_id !== mapping.id) continue;
        idx.set({
          outlineId: meta.outline_id,
          vaultPath: path,
          mappingId: mapping.id,
          parentOutlineId: meta.outline_parent_id ?? null,
          revision: meta.outline_revision ?? 0,
          syncedHash: meta.outline_synced_hash ?? '',
          lastSeenAt: meta.outline_last_synced ?? new Date(0).toISOString(),
          status: meta.outline_sync_status ?? 'synced',
        });
      }
    }
    await idx.save(this.indexStorage);
    this.index = idx;
  }

  private async ensureIndex(): Promise<LocalIndex> {
    if (!this.index) {
      this.index = await LocalIndex.load(this.indexStorage);
    }
    return this.index;
  }

  private async runMapping(mapping: SyncMapping): Promise<SyncMappingResult> {
    try {
      this.log(`Sync starting: ${mapping.source.displayName} → ${mapping.vaultPath}`);
      const roots = await this.walkSource(mapping);
      if (!roots) {
        return { mappingId: mapping.id, ok: false, events: [], error: 'walk failed' };
      }
      const index = await this.ensureIndex();
      const settings = this.getSettings();
      const result = await reconcileMapping({
        vault: this.vault,
        api: this.api,
        mapping,
        roots,
        index,
        outlineUrl: settings.outlineUrl,
        conflictBehavior: settings.conflictBehavior,
        pushNewLocal: false, // explicit user opt-in only; off by default
        onProgress: (e) => {
          if (settings.debugLogging) {
            this.log(`  ${e.action} ${e.vaultPath}${e.message ? `: ${e.message}` : ''}`);
          }
        },
      });
      mapping.lastFullSyncAt = new Date().toISOString();
      return { mappingId: mapping.id, ok: true, events: result.events };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`Sync failed: ${msg}`);
      return { mappingId: mapping.id, ok: false, events: [], error: msg };
    }
  }

  private async walkSource(mapping: SyncMapping): Promise<OutlineNode[] | null> {
    if (mapping.source.type === 'collection') {
      return walkCollection(mapping.source.outlineId, { api: this.api });
    }
    return walkDocument(mapping.source.outlineId, mapping.includeRoot, { api: this.api });
  }

  private async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    if (this.syncInFlight) {
      // Wait for whatever's running, then run.
      await this.syncInFlight.catch(() => undefined);
    }
    const p = task();
    this.syncInFlight = p;
    try {
      return await p;
    } finally {
      if (this.syncInFlight === p) this.syncInFlight = null;
    }
  }
}

function parseFromRaw(raw: string): OutlineFrontmatter {
  return getOutlineMeta(raw);
}
