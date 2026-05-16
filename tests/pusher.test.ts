import { pushCreate, pushUpdate } from '../src/bisync/pusher';
import { sha256 } from '../src/bisync/hash';
import type { IOutlineApi } from '../src/outline-api/types';

function fakeApi(): {
  api: IOutlineApi;
  lastUpdate?: { id: string; text: string; title: string };
  lastCreate?: { title: string; text: string; collectionId: string; parentDocumentId?: string };
} {
  const state: ReturnType<typeof fakeApi> = {
    api: {
      validateAuth: async () => 'u',
      listCollections: async () => [],
      getDocument: async () => null,
      async createDocument(params) {
        state.lastCreate = {
          title: params.title,
          text: params.text,
          collectionId: params.collectionId,
          parentDocumentId: params.parentDocumentId,
        };
        return {
          id: 'new-id',
          title: params.title,
          text: params.text + '\n', // server canonicalization
          collectionId: params.collectionId,
          revision: 1,
          urlId: 'short',
        };
      },
      async updateDocument(params) {
        state.lastUpdate = { id: params.id, text: params.text, title: params.title };
        return {
          id: params.id,
          title: params.title,
          text: params.text + '\n', // server adds trailing newline
          collectionId: 'c1',
          revision: 42,
          urlId: 'short',
        };
      },
      searchDocumentByTitle: async () => null,
      createAttachment: async () => null,
      uploadAttachmentToStorage: async () => false,
      listDocuments: async () => [],
      getCollectionDocumentTree: async () => null,
      getCollection: async () => null,
      deleteDocument: async () => true,
    },
  } as ReturnType<typeof fakeApi>;
  return state;
}

describe('pusher', () => {
  test('pushUpdate hashes the response body, not the sent body', async () => {
    const state = fakeApi();
    const sent = 'hello';
    const res = await pushUpdate(state.api, { id: 'd1', title: 'T', text: sent });
    expect(res).not.toBeNull();
    // Outline added a newline; hash must match server body.
    expect(res!.canonicalText).toBe('hello\n');
    expect(res!.syncedHash).toBe(await sha256('hello\n'));
    expect(res!.syncedHash).not.toBe(await sha256(sent));
    expect(res!.revision).toBe(42);
  });

  test('pushCreate returns the new outlineId and server-canonical hash', async () => {
    const state = fakeApi();
    const res = await pushCreate(state.api, {
      title: 'New',
      text: 'body',
      collectionId: 'c1',
      parentDocumentId: 'p1',
    });
    expect(res?.outlineId).toBe('new-id');
    expect(res?.canonicalText).toBe('body\n');
    expect(res?.syncedHash).toBe(await sha256('body\n'));
    expect(state.lastCreate?.parentDocumentId).toBe('p1');
  });
});
