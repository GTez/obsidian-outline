/**
 * Translate an Outline document tree into a vault layout that follows the
 * folder-note convention:
 *
 *   - A doc with no children → `<title>.md`
 *   - A doc with children   → `<title>/<title>.md` containing the parent's body,
 *                              plus children mapped inside that folder.
 *
 * The mapper is pure: given a tree of {@link OutlineNode}s plus a root
 * vault path, it returns a flat list of {@link PlannedFile} entries that
 * the caller can use to drive vault writes.
 */

import { ensureUniqueBasename, sanitizeBasename } from './sanitize';

export interface OutlineNode {
  id: string;
  title: string;
  parentId: string | null;
  /** ID of the collection this doc belongs to. */
  collectionId: string;
  /** Children, in the order they appear in Outline's tree (siblings.sort by position). */
  children: OutlineNode[];
  /** Optional Outline-side body. Caller may fill this in lazily. */
  text?: string;
  /** Outline revision number, when known. */
  revision?: number;
  /** Outline short-URL (`urlId`) for back-links. */
  urlId?: string;
}

export interface PlannedFile {
  outlineId: string;
  /** Absolute (vault-relative) path of the markdown file. */
  vaultPath: string;
  /** When true, this doc is a folder-note parent (has children → lives in `<basename>/<basename>.md`). */
  isFolderNote: boolean;
  /** ID of the parent doc in Outline, or null for mapping roots. */
  parentId: string | null;
  /** The sanitized basename without extension. */
  basename: string;
}

export interface PlanOptions {
  /** Vault path the mapping is rooted at. No trailing slash. */
  rootVaultPath: string;
  /** Outline-side roots (top-level nodes inside the mapping). */
  roots: OutlineNode[];
}

/**
 * Walk the Outline tree and produce a `PlannedFile` for each document.
 *
 * Sibling collisions after sanitization are resolved by appending `(1)`,
 * `(2)`, ... — but the resolution is deterministic per call: nodes are
 * processed in input order.
 */
export function planVaultLayout(opts: PlanOptions): PlannedFile[] {
  const plans: PlannedFile[] = [];
  for (const root of opts.roots) {
    visit(root, opts.rootVaultPath, plans);
  }
  return plans;
}

function visit(node: OutlineNode, parentDir: string, plans: PlannedFile[]): void {
  // Collect sibling basenames so we resolve collisions deterministically.
  // This is per-recursive-call but we use the existing plans list to learn
  // about already-placed siblings in this directory.
  const existingSiblings = new Set<string>(
    plans
      .filter((p) => directoryOf(p.vaultPath) === parentDir)
      .map((p) => p.basename)
  );

  const basename = ensureUniqueBasename(sanitizeBasename(node.title), existingSiblings);
  const hasChildren = node.children.length > 0;

  const vaultPath = hasChildren
    ? joinPath(parentDir, basename, `${basename}.md`)
    : joinPath(parentDir, `${basename}.md`);

  plans.push({
    outlineId: node.id,
    vaultPath,
    isFolderNote: hasChildren,
    parentId: node.parentId,
    basename,
  });

  if (hasChildren) {
    const childDir = joinPath(parentDir, basename);
    for (const child of node.children) {
      visit(child, childDir, plans);
    }
  }
}

function joinPath(...parts: string[]): string {
  return parts.filter((p) => p.length > 0).join('/').replace(/\/+/g, '/');
}

function directoryOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}
