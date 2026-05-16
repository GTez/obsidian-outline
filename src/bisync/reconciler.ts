/**
 * Per-mapping bidirectional reconciliation.
 *
 * One `reconcileMapping()` call:
 *  1. Walks the Outline subtree.
 *  2. Plans the canonical vault layout from that tree.
 *  3. Reads local files belonging to the mapping.
 *  4. For each Outline doc, decides pull / push / noop / conflict against
 *     the local copy — and applies renames when the doc's title or
 *     position changed.
 *  5. Marks orphans for local files whose Outline doc has left the
 *     subtree.
 *  6. (Optional) pushes new local files that don't yet have an
 *     outline_id.
 *
 * Conflict resolution is delegated to {@link handleConflict} (M6); when
 * the engine is constructed without a conflict handler, conflicts are
 * surfaced as errors and the file is skipped.
 */

import type { OutlineFrontmatter } from '../pipeline';
import type { ConflictBehavior, SyncMapping } from '../settings';
import type { IOutlineApi } from '../outline-api/types';
import {
  processInboundAttachments,
  processOutboundImages,
  type AttachmentFetcher,
} from './attachments';
import { hasUnresolvedConflict, writeConflictFile } from './conflict';
import { sha256 } from './hash';
import { planVaultLayout, type OutlineNode, type PlannedFile } from './hierarchy';
import type { IndexEntry, LocalIndex } from './local-index';
import { pushCreate, pushUpdate } from './pusher';
import { listLocalDocs, type LocalDoc } from './vault-walker';
import type { VaultIO } from './vault-io';

export type ReconcileAction =
  | 'noop'
  | 'pulled'
  | 'pushed'
  | 'created-local'
  | 'created-remote'
  | 'renamed'
  | 'orphaned'
  | 'conflict'
  | 'skipped';

export interface ReconcileEvent {
  outlineId?: string;
  vaultPath: string;
  action: ReconcileAction;
  message?: string;
}

export interface ConflictDecision {
  /** Caller wrote a conflict file (or otherwise handled the situation). */
  handled: boolean;
}

export interface ReconcileOptions {
  vault: VaultIO;
  api: IOutlineApi;
  mapping: SyncMapping;
  /** Outline-side roots after walking (honors mapping.includeRoot). */
  roots: OutlineNode[];
  index: LocalIndex;
  outlineUrl: string;
  conflictBehavior: ConflictBehavior;
  /** Hook into M6 — called once per (local-changed AND remote-changed) doc. */
  handleConflict?: (params: {
    localPath: string;
    localBody: string;
    remote: OutlineNode;
  }) => Promise<ConflictDecision>;
  onProgress?: (event: ReconcileEvent) => void;
  /** When true, pushes new vault files (no outline_id) up to Outline. */
  pushNewLocal?: boolean;
  /** API key for fetching attachment bytes during pull. */
  apiKey?: string;
  /** Test seam — overrides the HTTP fetcher used to download attachments. */
  attachmentFetcher?: AttachmentFetcher;
}

export interface ReconcileResult {
  events: ReconcileEvent[];
}

export async function reconcileMapping(opts: ReconcileOptions): Promise<ReconcileResult> {
  const events: ReconcileEvent[] = [];
  const emit = (e: ReconcileEvent): void => {
    events.push(e);
    opts.onProgress?.(e);
  };

  const plans = planVaultLayout({
    rootVaultPath: opts.mapping.vaultPath,
    roots: opts.roots,
  });
  const remoteById = indexNodes(opts.roots);
  const planById = new Map(plans.map((p) => [p.outlineId, p]));

  const localDocs = await listLocalDocs(opts.vault, opts.mapping);
  const localById = new Map<string, LocalDoc>();
  const localWithoutId: LocalDoc[] = [];
  for (const doc of localDocs) {
    if (doc.meta.outline_id) localById.set(doc.meta.outline_id, doc);
    else localWithoutId.push(doc);
  }

  // ── Pass 1: every doc present in Outline. Pull/push/conflict/noop. ────
  for (const plan of plans) {
    const remote = remoteById.get(plan.outlineId)!;
    const local = localById.get(plan.outlineId);

    if (!local) {
      await createLocalFromRemote(opts, plan, remote);
      emit({ outlineId: plan.outlineId, vaultPath: plan.vaultPath, action: 'created-local' });
      continue;
    }

    // Move / rename if the planned path differs from the current location.
    if (local.path !== plan.vaultPath) {
      await opts.vault.rename(local.path, plan.vaultPath);
      // Re-point local for the rest of this pass.
      local.path = plan.vaultPath;
      emit({ outlineId: plan.outlineId, vaultPath: plan.vaultPath, action: 'renamed' });
    }

    // If the user has an unresolved conflict file sitting next to this doc,
    // skip it — we don't want to overwrite their in-flight resolution work.
    if (await hasUnresolvedConflict(opts.vault, local.path)) {
      emit({
        outlineId: plan.outlineId,
        vaultPath: local.path,
        action: 'skipped',
        message: 'unresolved conflict file present',
      });
      continue;
    }

    const remoteChanged = (remote.revision ?? 0) > (local.meta.outline_revision ?? 0);
    if (local.changed && remoteChanged) {
      if (opts.conflictBehavior === 'create-conflict-file') {
        await invokeConflictHandler(opts, local, remote);
        // Bump the recorded remote revision so the user's eventual
        // resolution (delete conflict file + edit local) sees
        // remote_changed=false and pushes cleanly.
        await opts.vault.updateFrontmatter(local.path, {
          outline_sync_status: 'conflict',
          outline_revision: remote.revision,
        });
        emit({ outlineId: plan.outlineId, vaultPath: local.path, action: 'conflict' });
        continue;
      }
      // prefer-local / prefer-remote fall through to the relevant branch
      // below.
    }

    if (local.changed && !remoteChanged) {
      await pushLocal(opts, local, plan, remote);
      emit({ outlineId: plan.outlineId, vaultPath: local.path, action: 'pushed' });
      continue;
    }
    if (!local.changed && remoteChanged) {
      await pullRemoteOverLocal(opts, plan, remote);
      emit({ outlineId: plan.outlineId, vaultPath: local.path, action: 'pulled' });
      continue;
    }
    if (
      opts.conflictBehavior === 'prefer-local' &&
      local.changed &&
      remoteChanged
    ) {
      await pushLocal(opts, local, plan, remote);
      emit({ outlineId: plan.outlineId, vaultPath: local.path, action: 'pushed' });
      continue;
    }
    if (
      opts.conflictBehavior === 'prefer-remote' &&
      local.changed &&
      remoteChanged
    ) {
      await pullRemoteOverLocal(opts, plan, remote);
      emit({ outlineId: plan.outlineId, vaultPath: local.path, action: 'pulled' });
      continue;
    }
    // (false, false) → noop
    emit({ outlineId: plan.outlineId, vaultPath: local.path, action: 'noop' });
  }

  // ── Pass 2: local docs whose outline_id is no longer in the subtree. ──
  for (const local of localDocs) {
    const oid = local.meta.outline_id;
    if (!oid || planById.has(oid)) continue;
    if (local.meta.outline_sync_status === 'orphaned') continue;
    await opts.vault.updateFrontmatter(local.path, { outline_sync_status: 'orphaned' });
    const entry = opts.index.get(oid);
    if (entry) {
      opts.index.set({ ...entry, status: 'orphaned' });
    }
    emit({ outlineId: oid, vaultPath: local.path, action: 'orphaned' });
  }

  // ── Pass 3: new vault files (no outline_id) → push if enabled. ────────
  if (opts.pushNewLocal) {
    for (const doc of localWithoutId) {
      await createRemoteFromLocal(opts, doc);
      emit({ vaultPath: doc.path, action: 'created-remote' });
    }
  }

  return { events };
}

/** Walk a root forest into `Map<id, node>`. */
function indexNodes(roots: OutlineNode[]): Map<string, OutlineNode> {
  const out = new Map<string, OutlineNode>();
  const walk = (n: OutlineNode): void => {
    out.set(n.id, n);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

async function createLocalFromRemote(
  opts: ReconcileOptions,
  plan: PlannedFile,
  remote: OutlineNode
): Promise<void> {
  const dir = directoryOf(plan.vaultPath);
  if (dir) await opts.vault.ensureFolder(dir);
  const body = await rewriteForLocal(opts, plan.vaultPath, remote.text ?? '');
  await opts.vault.write(plan.vaultPath, body);
  const hash = await sha256(body);
  await opts.vault.updateFrontmatter(plan.vaultPath, frontmatterFor(remote, opts, hash));
  opts.index.set(toIndexEntry(plan, remote, hash, opts.mapping.id));
}

async function pushLocal(
  opts: ReconcileOptions,
  local: LocalDoc,
  plan: PlannedFile,
  remote: OutlineNode
): Promise<void> {
  // Upload any image references the user added, replacing local refs with
  // Outline URLs in the body we'll send.
  const outboundBody = await rewriteForRemote(opts, plan.vaultPath, local.body, remote.id);
  const res = await pushUpdate(opts.api, {
    id: remote.id,
    title: remote.title,
    text: outboundBody,
  });
  if (!res) return;
  // The body sitting on disk is the local-refs version — we don't rewrite
  // disk on push. The synced hash is over that disk body, so a re-pull
  // against an unchanged remote will (after attachment download +
  // local-refs rewrite) hash to the same value.
  const localHash = await sha256(local.body);
  await opts.vault.updateFrontmatter(plan.vaultPath, {
    outline_revision: res.revision,
    outline_synced_hash: localHash,
    outline_last_synced: new Date().toISOString(),
    outline_sync_status: 'synced',
    outline_title: res.title || remote.title,
    outline_url: res.urlId
      ? `${opts.outlineUrl.replace(/\/$/, '')}/doc/${res.urlId}`
      : undefined,
  });
  opts.index.set(
    toIndexEntry(plan, { ...remote, revision: res.revision }, localHash, opts.mapping.id)
  );
}

async function pullRemoteOverLocal(
  opts: ReconcileOptions,
  plan: PlannedFile,
  remote: OutlineNode
): Promise<void> {
  const body = await rewriteForLocal(opts, plan.vaultPath, remote.text ?? '');
  await opts.vault.write(plan.vaultPath, body);
  const hash = await sha256(body);
  await opts.vault.updateFrontmatter(plan.vaultPath, frontmatterFor(remote, opts, hash));
  opts.index.set(toIndexEntry(plan, remote, hash, opts.mapping.id));
}

async function createRemoteFromLocal(
  opts: ReconcileOptions,
  doc: LocalDoc
): Promise<void> {
  const basename = doc.path.split('/').pop()!.replace(/\.md$/, '');
  const collectionId = collectionIdForMapping(opts);
  if (!collectionId) return;
  // Create first so we have an Outline doc id to attach uploads to.
  const initial = await pushCreate(opts.api, {
    title: basename,
    text: doc.body,
    collectionId,
  });
  if (!initial) return;
  // Now upload any images and re-update if the body changed.
  const outboundBody = await rewriteForRemote(opts, doc.path, doc.body, initial.outlineId);
  if (outboundBody !== doc.body) {
    await pushUpdate(opts.api, {
      id: initial.outlineId,
      title: basename,
      text: outboundBody,
    });
  }
  const localHash = await sha256(doc.body);
  await opts.vault.updateFrontmatter(doc.path, {
    outline_id: initial.outlineId,
    outline_collection_id: collectionId,
    outline_revision: initial.revision,
    outline_synced_hash: localHash,
    outline_last_synced: new Date().toISOString(),
    outline_sync_status: 'synced',
    outline_mapping_id: opts.mapping.id,
    outline_title: initial.title,
    outline_parent_id: null,
    outline_url: initial.urlId
      ? `${opts.outlineUrl.replace(/\/$/, '')}/doc/${initial.urlId}`
      : undefined,
  });
}

async function invokeConflictHandler(
  opts: ReconcileOptions,
  local: LocalDoc,
  remote: OutlineNode
): Promise<void> {
  if (opts.handleConflict) {
    await opts.handleConflict({
      localPath: local.path,
      localBody: local.body,
      remote,
    });
    return;
  }
  // Built-in default: write the conflict file ourselves.
  await writeConflictFile({
    vault: opts.vault,
    localPath: local.path,
    remote,
  });
}

function collectionIdForMapping(opts: ReconcileOptions): string | undefined {
  if (opts.mapping.source.type === 'collection') return opts.mapping.source.outlineId;
  // For document-rooted mappings, infer from the first root.
  for (const r of opts.roots) {
    if (r.collectionId) return r.collectionId;
  }
  return undefined;
}

function frontmatterFor(
  node: OutlineNode,
  opts: ReconcileOptions,
  hash: string
): OutlineFrontmatter {
  return {
    outline_id: node.id,
    outline_collection_id: node.collectionId,
    outline_parent_id: node.parentId,
    outline_revision: node.revision,
    outline_synced_hash: hash,
    outline_last_synced: new Date().toISOString(),
    outline_sync_status: 'synced',
    outline_mapping_id: opts.mapping.id,
    outline_title: node.title,
    outline_url: node.urlId
      ? `${opts.outlineUrl.replace(/\/$/, '')}/doc/${node.urlId}`
      : undefined,
  };
}

function toIndexEntry(
  plan: PlannedFile,
  node: OutlineNode,
  hash: string,
  mappingId: string
): IndexEntry {
  return {
    outlineId: node.id,
    vaultPath: plan.vaultPath,
    mappingId,
    parentOutlineId: node.parentId,
    revision: node.revision ?? 0,
    syncedHash: hash,
    lastSeenAt: new Date().toISOString(),
    status: 'synced',
  };
}

function directoryOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/**
 * Process attachments in a body arriving from Outline. Downloads each
 * referenced attachment into the vault and rewrites the markdown to use
 * local relative paths.
 */
async function rewriteForLocal(
  opts: ReconcileOptions,
  notePath: string,
  body: string
): Promise<string> {
  if (!opts.apiKey && !opts.attachmentFetcher) return body;
  const res = await processInboundAttachments({
    vault: opts.vault,
    outlineUrl: opts.outlineUrl,
    apiKey: opts.apiKey ?? '',
    notePath,
    body,
    fetcher: opts.attachmentFetcher,
  });
  return res.body;
}

/**
 * Process image references in a body about to be pushed to Outline.
 * Uploads each via the Outline API and rewrites the markdown to use the
 * returned Outline URLs.
 */
async function rewriteForRemote(
  opts: ReconcileOptions,
  notePath: string,
  body: string,
  documentId: string
): Promise<string> {
  const res = await processOutboundImages({
    vault: opts.vault,
    api: opts.api,
    notePath,
    body,
    documentId,
  });
  return res.body;
}
