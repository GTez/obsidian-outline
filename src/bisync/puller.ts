/**
 * Pull a planned vault layout from a freshly-walked Outline subtree into
 * the vault.
 *
 * The puller is deliberately dumb: it writes each file as-is and stamps
 * the frontmatter with everything the reconciler will later need to make
 * decisions. Reconciliation (the "what should we do when both sides
 * changed" logic) lives in `reconciler.ts`.
 */

import type { OutlineFrontmatter } from '../pipeline';
import type { SyncMapping } from '../settings';
import { sha256 } from './hash';
import type { OutlineNode, PlannedFile } from './hierarchy';
import { planVaultLayout } from './hierarchy';
import type { IndexEntry, LocalIndex } from './local-index';
import type { VaultIO } from './vault-io';

export interface PullOptions {
  vault: VaultIO;
  mapping: SyncMapping;
  /** Outline-side roots for this mapping (already accounts for includeRoot). */
  roots: OutlineNode[];
  /** Optional progress callback. */
  onProgress?: (msg: string) => void;
  /** Base URL of the Outline instance, used to populate outline_url frontmatter. */
  outlineUrl: string;
  index: LocalIndex;
}

export interface PullResult {
  /** Files newly written or updated. */
  written: string[];
  /** Files we walked but found already up to date. */
  unchanged: string[];
  errors: { vaultPath: string; error: string }[];
}

export async function pullMapping(opts: PullOptions): Promise<PullResult> {
  const plans = planVaultLayout({ rootVaultPath: opts.mapping.vaultPath, roots: opts.roots });
  const byId = indexNodes(opts.roots);
  const result: PullResult = { written: [], unchanged: [], errors: [] };

  for (const plan of plans) {
    const node = byId.get(plan.outlineId);
    if (!node) {
      result.errors.push({ vaultPath: plan.vaultPath, error: 'node missing from walk' });
      continue;
    }
    try {
      const dir = directoryOf(plan.vaultPath);
      if (dir) await opts.vault.ensureFolder(dir);

      const content = buildNoteContent(node);
      const hash = await sha256(content);
      const fm = buildFrontmatter(plan, node, hash, opts);

      await opts.vault.write(plan.vaultPath, content);
      await opts.vault.updateFrontmatter(plan.vaultPath, fm);

      opts.index.set(toIndexEntry(plan, node, hash, opts.mapping.id));
      result.written.push(plan.vaultPath);
      opts.onProgress?.(`Pulled ${plan.vaultPath}`);
    } catch (e) {
      result.errors.push({
        vaultPath: plan.vaultPath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}

function indexNodes(roots: OutlineNode[]): Map<string, OutlineNode> {
  const out = new Map<string, OutlineNode>();
  const walk = (n: OutlineNode): void => {
    out.set(n.id, n);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

function buildNoteContent(node: OutlineNode): string {
  // Outline's body is canonical markdown. We never modify it on pull.
  return node.text ?? '';
}

function buildFrontmatter(
  plan: PlannedFile,
  node: OutlineNode,
  syncedHash: string,
  opts: PullOptions
): OutlineFrontmatter {
  return {
    outline_id: node.id,
    outline_collection_id: node.collectionId,
    outline_parent_id: node.parentId,
    outline_revision: node.revision,
    outline_synced_hash: syncedHash,
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
  syncedHash: string,
  mappingId: string
): IndexEntry {
  return {
    outlineId: node.id,
    vaultPath: plan.vaultPath,
    mappingId,
    parentOutlineId: node.parentId,
    revision: node.revision ?? 0,
    syncedHash,
    lastSeenAt: new Date().toISOString(),
    status: 'synced',
  };
}

function directoryOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}
