/**
 * Find local files that belong to a sync mapping.
 *
 * A file "belongs" to mapping `m` when its frontmatter carries
 * `outline_mapping_id: m.id`. Files under the mapping's vault path that
 * lack this marker are treated as new (they'll be pushed up if they look
 * like documents and the mapping is configured to do so).
 */

import { getOutlineMeta, type OutlineFrontmatter } from '../pipeline';
import type { SyncMapping } from '../settings';
import { sha256 } from './hash';
import { stripFrontmatter } from '../pipeline';
import type { VaultIO } from './vault-io';

export interface LocalDoc {
  path: string;
  meta: OutlineFrontmatter;
  body: string;
  bodyHash: string;
  /** True iff body hash differs from meta.outline_synced_hash. */
  changed: boolean;
}

export async function listLocalDocs(
  vault: VaultIO,
  mapping: SyncMapping
): Promise<LocalDoc[]> {
  const paths = await vault.listMarkdown(mapping.vaultPath);
  const docs: LocalDoc[] = [];
  for (const path of paths) {
    const raw = await vault.read(path);
    const meta = getOutlineMeta(raw);
    if (meta.conflict_for) continue; // resolution-workflow file; never synced
    if (meta.outline_mapping_id && meta.outline_mapping_id !== mapping.id) continue;
    const body = stripFrontmatter(raw);
    const bodyHash = await sha256(body);
    const changed = meta.outline_synced_hash !== bodyHash;
    docs.push({ path, meta, body, bodyHash, changed });
  }
  return docs;
}
