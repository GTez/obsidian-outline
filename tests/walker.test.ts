import { walkCollection, walkDocument } from '../src/bisync/walker';
import type { Document, IOutlineApi, NavigationNode } from '../src/outline-api/types';

function makeFakeApi(docs: Document[], tree?: NavigationNode[]): IOutlineApi {
  const byId = new Map<string, Document>(docs.map((d) => [d.id!, d]));
  return {
    async validateAuth() {
      return 'u';
    },
    async listCollections() {
      return [];
    },
    async getDocument(id) {
      return byId.get(id) ?? null;
    },
    async createDocument() {
      return null;
    },
    async updateDocument() {
      return null;
    },
    async searchDocumentByTitle() {
      return null;
    },
    async createAttachment() {
      return null;
    },
    async uploadAttachmentToStorage() {
      return false;
    },
    async listDocuments({ parentDocumentId }) {
      return docs.filter((d) => d.parentDocumentId === parentDocumentId);
    },
    async getCollectionDocumentTree() {
      return tree ?? null;
    },
    async getCollection() {
      return null;
    },
    async deleteDocument() {
      return true;
    },
  };
}

describe('walker', () => {
  test('walkCollection hydrates a NavigationNode tree', async () => {
    const docs: Document[] = [
      {
        id: 'root',
        title: 'Root',
        collectionId: 'c1',
        text: 'Root body',
        revision: 1,
      },
      {
        id: 'child',
        title: 'Child',
        collectionId: 'c1',
        parentDocumentId: 'root',
        text: 'Child body',
        revision: 1,
      },
    ];
    const tree: NavigationNode[] = [
      { id: 'root', title: 'Root', children: [{ id: 'child', title: 'Child', children: [] }] },
    ];
    const api = makeFakeApi(docs, tree);
    const result = await walkCollection('c1', { api });
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe('root');
    expect(result![0].text).toBe('Root body');
    expect(result![0].children).toHaveLength(1);
    expect(result![0].children[0].id).toBe('child');
    expect(result![0].children[0].text).toBe('Child body');
  });

  test('walkDocument paginates children via documents.list', async () => {
    const docs: Document[] = [
      {
        id: 'root',
        title: 'Root',
        collectionId: 'c1',
        text: 'Root body',
        revision: 1,
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        title: `Child ${i}`,
        collectionId: 'c1',
        parentDocumentId: 'root',
        text: `Body ${i}`,
        revision: 1,
      })),
    ];
    const api = makeFakeApi(docs);
    const result = await walkDocument('root', /* includeRoot */ true, { api });
    expect(result).toHaveLength(1);
    expect(result![0].children).toHaveLength(5);
  });

  test('walkDocument with includeRoot=false returns children only', async () => {
    const docs: Document[] = [
      { id: 'root', title: 'Root', collectionId: 'c1', text: '', revision: 1 },
      {
        id: 'c1',
        title: 'Child',
        collectionId: 'c1',
        parentDocumentId: 'root',
        text: '',
        revision: 1,
      },
    ];
    const api = makeFakeApi(docs);
    const result = await walkDocument('root', false, { api });
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe('c1');
  });
});
