/**
 * Read a vault file and decide whether the local body has changed since
 * the last sync.
 *
 * "Local body" means content with frontmatter stripped — frontmatter is
 * sync metadata, not user content, and would otherwise pollute the hash.
 */

import { getOutlineMeta, stripFrontmatter, type OutlineFrontmatter } from '../pipeline';
import { sha256 } from './hash';
import type { VaultIO } from './vault-io';

export interface LocalSnapshot {
  /** Raw file contents (with frontmatter). */
  raw: string;
  /** Body with the YAML frontmatter block stripped. */
  body: string;
  /** SHA-256 of `body`. */
  bodyHash: string;
  /** Parsed Outline-sync frontmatter (may be empty for un-synced files). */
  meta: OutlineFrontmatter;
  /** True iff bodyHash differs from meta.outline_synced_hash. */
  changed: boolean;
}

export async function readLocal(vault: VaultIO, path: string): Promise<LocalSnapshot> {
  const raw = await vault.read(path);
  const body = stripFrontmatter(raw);
  const bodyHash = await sha256(body);
  const meta = getOutlineMeta(raw);
  const changed = meta.outline_synced_hash !== bodyHash;
  return { raw, body, bodyHash, meta, changed };
}
