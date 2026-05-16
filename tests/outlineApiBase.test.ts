import { OutlineApiBase } from '../src/outline-api/outline-api-base';
import type { Transport, TransportResponse } from '../src/outline-api/custom-instance';

class TestApi extends OutlineApiBase {
  async uploadAttachmentToStorage(): Promise<boolean> {
    return false;
  }
}

interface Recorded {
  url: string;
  body: unknown;
}

function makeTransport(handler: (req: Recorded) => { status: number; body: unknown }): {
  transport: Transport;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const transport: Transport = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const recorded = { url, body };
    calls.push(recorded);
    const { status, body: respBody } = handler(recorded);
    const res: TransportResponse = {
      status,
      headers: new Headers(),
      json: async () => respBody,
    };
    return res;
  };
  return { transport, calls };
}

describe('OutlineApiBase', () => {
  test('getDocument routes to documents.info with the supplied id', async () => {
    const { transport, calls } = makeTransport(() => ({
      status: 200,
      body: { data: { id: 'doc-1', title: 'Hi', revision: 3 } },
    }));
    const api = new TestApi('https://o.example', 'k', transport);
    const doc = await api.getDocument('doc-1');
    expect(doc?.id).toBe('doc-1');
    expect(doc?.revision).toBe(3);
    expect(calls[0].url).toBe('https://o.example/api/documents.info');
    expect(calls[0].body).toEqual({ id: 'doc-1' });
  });

  test('listDocuments paginates with the requested params', async () => {
    const { transport, calls } = makeTransport(() => ({
      status: 200,
      body: { data: [{ id: 'a' }, { id: 'b' }] },
    }));
    const api = new TestApi('https://o.example', 'k', transport);
    const docs = await api.listDocuments({ parentDocumentId: 'p1', offset: 100, limit: 50 });
    expect(docs).toHaveLength(2);
    expect(calls[0].url).toBe('https://o.example/api/documents.list');
    expect(calls[0].body).toMatchObject({
      parentDocumentId: 'p1',
      offset: 100,
      limit: 50,
    });
  });

  test('listDocuments returns [] on success-but-empty', async () => {
    const { transport } = makeTransport(() => ({ status: 200, body: {} }));
    const api = new TestApi('https://o.example', 'k', transport);
    const docs = await api.listDocuments({ parentDocumentId: 'p1' });
    expect(docs).toEqual([]);
  });

  test('listDocuments returns null on non-200', async () => {
    const { transport } = makeTransport(() => ({ status: 500, body: {} }));
    const api = new TestApi('https://o.example', 'k', transport);
    // Note: customInstance retries 5xx three times, then returns the last
    // response. The wrapper sees 500 and returns null.
    const docs = await api.listDocuments({ parentDocumentId: 'p1' });
    expect(docs).toBeNull();
  });

  test('getCollectionDocumentTree normalizes single-node response to array', async () => {
    const { transport } = makeTransport(() => ({
      status: 200,
      body: { data: { id: 'root', children: [{ id: 'child' }] } },
    }));
    const api = new TestApi('https://o.example', 'k', transport);
    const nodes = await api.getCollectionDocumentTree('c1');
    expect(nodes).toHaveLength(1);
    expect(nodes?.[0].id).toBe('root');
  });

  test('deleteDocument returns true on 200, false otherwise', async () => {
    let status = 200;
    const { transport } = makeTransport(() => ({ status, body: { success: true } }));
    const api = new TestApi('https://o.example', 'k', transport);
    expect(await api.deleteDocument('d1')).toBe(true);
    status = 404;
    expect(await api.deleteDocument('d2')).toBe(false);
  });

  test('updateDocument returns the response document, not the sent payload', async () => {
    // Critical: Outline canonicalizes markdown server-side. The caller MUST
    // hash the response body, never the sent body.
    const { transport } = makeTransport(({ body }) => {
      const sent = body as { text: string };
      return {
        status: 200,
        body: {
          data: {
            id: 'd1',
            title: 'X',
            text: sent.text + '\n',
            revision: 42,
          },
        },
      };
    });
    const api = new TestApi('https://o.example', 'k', transport);
    const updated = await api.updateDocument({
      id: 'd1',
      title: 'X',
      text: 'hello',
      publish: true,
    });
    expect(updated?.text).toBe('hello\n'); // server-canonicalized
    expect(updated?.revision).toBe(42);
  });
});
