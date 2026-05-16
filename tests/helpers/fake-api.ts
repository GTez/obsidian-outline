import type {
  AttachmentsCreate200Data,
  Document,
  IOutlineApi,
  NavigationNode,
} from '../../src/outline-api/types';

/**
 * In-memory Outline API for engine-level tests.
 *
 * Build trees with `seedTree(...)` then drive the reconciler against the
 * fake. The fake mimics two real behaviors:
 *  1. updateDocument bumps the document revision.
 *  2. updateDocument canonicalizes the body (appends a newline) so callers
 *     have to hash the response, not the input.
 */
export class FakeApi implements IOutlineApi {
  docs = new Map<string, Document>();
  collections = new Map<string, NavigationNode[]>();
  createdRequests: { title: string; text: string; collectionId: string; parentDocumentId?: string }[] = [];
  updatedRequests: { id: string; title: string; text: string }[] = [];
  /** When true, server canonicalization appends "\n" to bodies on update/create. */
  canonicalizeOnWrite = true;
  private nextId = 1000;

  seed(doc: Document): void {
    this.docs.set(doc.id!, doc);
  }

  seedCollectionTree(collectionId: string, tree: NavigationNode[]): void {
    this.collections.set(collectionId, tree);
  }

  bumpRevision(id: string, newText?: string): void {
    const d = this.docs.get(id);
    if (!d) return;
    (d as { revision?: number }).revision = (d.revision ?? 0) + 1;
    if (newText !== undefined) d.text = newText;
  }

  async validateAuth(): Promise<string | null> {
    return 'tester';
  }
  async listCollections(): Promise<[]> {
    return [];
  }
  async getDocument(id: string): Promise<Document | null> {
    const d = this.docs.get(id);
    return d ? { ...d } : null;
  }
  async createDocument(params: {
    title: string;
    text: string;
    collectionId: string;
    publish: boolean;
    parentDocumentId?: string;
  }): Promise<Document | null> {
    const id = `doc-${this.nextId++}`;
    const text = this.canonicalizeOnWrite ? params.text + '\n' : params.text;
    const doc: Document = {
      id,
      title: params.title,
      text,
      collectionId: params.collectionId,
      parentDocumentId: params.parentDocumentId,
      revision: 1,
      urlId: id + 'Short',
    };
    this.docs.set(id, doc);
    this.createdRequests.push({
      title: params.title,
      text: params.text,
      collectionId: params.collectionId,
      parentDocumentId: params.parentDocumentId,
    });
    return { ...doc };
  }
  async updateDocument(params: {
    id: string;
    title: string;
    text: string;
    publish: boolean;
  }): Promise<Document | null> {
    const d = this.docs.get(params.id);
    if (!d) return null;
    d.title = params.title;
    d.text = this.canonicalizeOnWrite ? params.text + '\n' : params.text;
    (d as { revision?: number }).revision = (d.revision ?? 0) + 1;
    this.updatedRequests.push({ id: params.id, title: params.title, text: params.text });
    return { ...d };
  }
  async searchDocumentByTitle(): Promise<null> {
    return null;
  }
  createAttachment: IOutlineApi['createAttachment'] = async (): Promise<AttachmentsCreate200Data | null> =>
    null;
  uploadAttachmentToStorage: IOutlineApi['uploadAttachmentToStorage'] = async (): Promise<boolean> =>
    false;
  async listDocuments(params: {
    parentDocumentId?: string;
    collectionId?: string;
  }): Promise<Document[]> {
    const out: Document[] = [];
    for (const d of this.docs.values()) {
      if (params.parentDocumentId && d.parentDocumentId !== params.parentDocumentId) continue;
      if (params.collectionId && d.collectionId !== params.collectionId) continue;
      out.push({ ...d });
    }
    return out;
  }
  async getCollectionDocumentTree(id: string): Promise<NavigationNode[] | null> {
    return this.collections.get(id) ?? null;
  }
  async getCollection(): Promise<null> {
    return null;
  }
  async deleteDocument(id: string): Promise<boolean> {
    return this.docs.delete(id);
  }
}
