import { App, TFile } from 'obsidian';
import type { OutlineFrontmatter } from './pipeline';

export { parseFrontmatter, stripFrontmatter, getOutlineMeta } from './pipeline';
export type { OutlineFrontmatter } from './pipeline';

/**
 * Update the Outline-sync portion of a note's frontmatter.
 *
 * Only keys present in `updates` are written; other keys (including user
 * fields) are left untouched. Pass `null` for a key to clear it.
 *
 * Always goes through `app.fileManager.processFrontMatter` so YAML quoting
 * and edge cases are handled by Obsidian, not us.
 */
export async function updateOutlineFrontmatter(
  app: App,
  file: TFile,
  updates: OutlineFrontmatter
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    applyFrontmatterUpdates(fm, updates);
  });
}

/** Pure logic — exported so unit tests can verify the merge rules. */
export function applyFrontmatterUpdates(
  fm: Record<string, unknown>,
  updates: OutlineFrontmatter
): void {
  const assign = <K extends keyof OutlineFrontmatter>(key: K): void => {
    const v = updates[key];
    if (v === undefined) return;
    if (v === null) {
      delete fm[key];
      return;
    }
    fm[key as string] = v;
  };
  assign('outline_id');
  assign('outline_collection_id');
  assign('outline_last_synced');
  assign('outline_revision');
  assign('outline_synced_hash');
  assign('outline_parent_id');
  assign('outline_url');
  assign('outline_sync_status');
  assign('outline_mapping_id');
  assign('outline_title');
  assign('conflict_for');
  assign('outline_attachments');
}
