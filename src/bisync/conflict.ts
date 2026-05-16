/**
 * Conflict handling.
 *
 * Default strategy: drop a sibling file containing the remote version,
 * leave the local file alone, and let the user resolve. The sibling file
 * is named `<basename>.outline-conflict-<timestamp>.md` so it sorts next
 * to the original and is easy to find.
 *
 * The conflict file carries minimal frontmatter (`outline_id`,
 * `outline_revision`, `conflict_for`) so the user can see what it relates
 * to. It is *not* itself synced — the reconciler ignores any file with
 * `conflict_for` set.
 */

import type { OutlineNode } from './hierarchy';
import type { VaultIO } from './vault-io';

export interface WriteConflictParams {
  vault: VaultIO;
  localPath: string;
  remote: OutlineNode;
  /** Test seam — defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * Write `<basename>.outline-conflict-<ts>.md` next to `localPath`.
 * Returns the path that was written.
 */
export async function writeConflictFile(params: WriteConflictParams): Promise<string> {
  const conflictPath = conflictPathFor(params.localPath, (params.now ?? (() => new Date()))());
  const body = params.remote.text ?? '';
  await params.vault.write(conflictPath, body);
  await params.vault.updateFrontmatter(conflictPath, {
    outline_id: params.remote.id,
    outline_revision: params.remote.revision,
    conflict_for: params.localPath,
  });
  return conflictPath;
}

/** Has a conflict file already been written for this path? */
export async function hasUnresolvedConflict(
  vault: VaultIO,
  localPath: string
): Promise<boolean> {
  const dir = directoryOf(localPath);
  const basename = basenameOf(localPath);
  const stem = basename.replace(/\.md$/, '');
  const siblings = await vault.listMarkdown(dir);
  return siblings.some((p) => {
    const sb = basenameOf(p);
    return sb.startsWith(`${stem}.outline-conflict-`) && sb.endsWith('.md');
  });
}

export function conflictPathFor(localPath: string, when: Date): string {
  const dir = directoryOf(localPath);
  const base = basenameOf(localPath).replace(/\.md$/, '');
  const ts = when.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const name = `${base}.outline-conflict-${ts}.md`;
  return dir ? `${dir}/${name}` : name;
}

function directoryOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function basenameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}
