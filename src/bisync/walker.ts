/**
 * Walk an Outline subtree and produce {@link OutlineNode} trees ready to
 * feed into {@link planVaultLayout}.
 *
 * Two entry points:
 *  - {@link walkCollection} — root is a collection; uses `collections.documents`
 *    to fetch the whole nav tree in one call, then hydrates per-doc bodies on
 *    demand via `documents.info`.
 *  - {@link walkDocument} — root is a single document; uses `documents.list`
 *    with `parentDocumentId` to recurse, paginated.
 *
 * The walker yields nodes with `text` and `revision` populated. Bodies must
 * be fetched per-document — `documents.list` returns metadata but not body
 * text — so this is the dominant cost on first sync.
 */

import type { Document, IOutlineApi, NavigationNode } from '../outline-api/types';
import type { OutlineNode } from './hierarchy';

const PAGE_SIZE = 100;

export interface WalkOptions {
  api: IOutlineApi;
  /** Optional progress callback — called once per document fetched. */
  onProgress?: (msg: string) => void;
}

/**
 * Walk a collection. Returns a forest (top-level docs in the collection)
 * with full bodies populated.
 */
export async function walkCollection(
  collectionId: string,
  opts: WalkOptions
): Promise<OutlineNode[] | null> {
  const tree = await opts.api.getCollectionDocumentTree(collectionId);
  if (!tree) return null;
  const roots: OutlineNode[] = [];
  for (const navNode of tree) {
    const node = await hydrateNav(navNode, null, collectionId, opts);
    if (node) roots.push(node);
  }
  return roots;
}

/**
 * Walk a single document. `includeRoot` determines whether the document
 * itself is in the returned forest, or only its children.
 */
export async function walkDocument(
  documentId: string,
  includeRoot: boolean,
  opts: WalkOptions
): Promise<OutlineNode[] | null> {
  const root = await opts.api.getDocument(documentId);
  if (!root || !root.id) return null;
  const rootNode = await buildNodeFromDocument(root, opts);
  if (includeRoot) {
    return [rootNode];
  }
  return rootNode.children;
}

async function hydrateNav(
  nav: NavigationNode,
  parentId: string | null,
  collectionId: string,
  opts: WalkOptions
): Promise<OutlineNode | null> {
  if (!nav.id) return null;
  const doc = await opts.api.getDocument(nav.id);
  if (!doc) return null;
  opts.onProgress?.(`Fetched ${doc.title ?? nav.id}`);
  const children: OutlineNode[] = [];
  for (const child of nav.children ?? []) {
    const childNode = await hydrateNav(child, nav.id, collectionId, opts);
    if (childNode) children.push(childNode);
  }
  return {
    id: doc.id ?? nav.id,
    title: doc.title ?? nav.title ?? 'Untitled',
    parentId,
    collectionId: doc.collectionId ?? collectionId,
    children,
    text: doc.text ?? '',
    revision: doc.revision,
    urlId: doc.urlId,
  };
}

async function buildNodeFromDocument(doc: Document, opts: WalkOptions): Promise<OutlineNode> {
  opts.onProgress?.(`Fetched ${doc.title ?? doc.id}`);
  const id = doc.id!;
  const children = await listChildren(id, opts);
  const childNodes: OutlineNode[] = [];
  for (const child of children) {
    childNodes.push(await buildNodeFromDocument(child, opts));
  }
  return {
    id,
    title: doc.title ?? 'Untitled',
    parentId: doc.parentDocumentId ?? null,
    collectionId: doc.collectionId ?? '',
    children: childNodes,
    text: doc.text ?? '',
    revision: doc.revision,
    urlId: doc.urlId,
  };
}

async function listChildren(parentId: string, opts: WalkOptions): Promise<Document[]> {
  const all: Document[] = [];
  let offset = 0;
  // Cap at 5000 to avoid runaway loops on broken APIs.
  for (let safety = 0; safety < 50; safety++) {
    const page = await opts.api.listDocuments({
      parentDocumentId: parentId,
      offset,
      limit: PAGE_SIZE,
    });
    if (!page) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }
  // documents.list returns metadata only; we need bodies → re-fetch.
  const hydrated: Document[] = [];
  for (const doc of all) {
    if (!doc.id) continue;
    const full = await opts.api.getDocument(doc.id);
    if (full) hydrated.push(full);
  }
  return hydrated;
}
