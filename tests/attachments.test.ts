import {
  processInboundAttachments,
  processOutboundImages,
  type AttachmentFetcher,
} from '../src/bisync/attachments';
import { FakeApi } from './helpers/fake-api';
import { MemoryVault } from './helpers/memory-vault';

function bytesFor(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

describe('processOutboundImages', () => {
  test('uploads each detected image and rewrites refs', async () => {
    const vault = new MemoryVault();
    vault.seedBinary('Notes/_attachments/diagram.png', bytesFor('PNG_BYTES'), 'image/png');
    const api = new FakeApi();
    // Stub createAttachment to return a fake upload URL.
    const origCreate = api.createAttachment.bind(api);
    api.createAttachment = async () => ({
      uploadUrl: 'https://outline.example.com/api/files',
      form: { key: 'k' },
      attachment: { url: 'https://outline.example.com/api/attachments.redirect?id=att-1' },
    });
    void origCreate;
    api.uploadAttachmentToStorage = async () => true;

    const body = 'See diagram:\n\n![](_attachments/diagram.png)\n';
    const res = await processOutboundImages({
      vault,
      api,
      notePath: 'Notes/Doc.md',
      body,
      documentId: 'd1',
    });
    expect(res.uploaded).toBe(1);
    expect(res.body).toContain('![diagram](https://outline.example.com/api/attachments.redirect?id=att-1)');
    expect(res.body).not.toContain('_attachments/diagram.png');
  });

  test('inserts a placeholder when the image is missing', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const body = '![](missing.png)';
    const res = await processOutboundImages({
      vault,
      api,
      notePath: 'Notes/Doc.md',
      body,
      documentId: 'd1',
    });
    expect(res.uploaded).toBe(0);
    expect(res.body).toContain('Image not found');
  });
});

describe('processInboundAttachments', () => {
  test('downloads each Outline-hosted attachment and rewrites refs', async () => {
    const vault = new MemoryVault();
    const fetcher: AttachmentFetcher = async () => ({
      bytes: bytesFor('JPG_BYTES'),
      contentType: 'image/jpeg',
    });
    const body = 'See:\n\n![](https://outline.example.com/api/attachments.redirect?id=abcd-1234)\n';
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://outline.example.com',
      apiKey: 'k',
      notePath: 'Notes/Doc.md',
      body,
      fetcher,
    });
    expect(res.downloaded).toBe(1);
    expect(res.body).toContain('_attachments/');
    expect(res.body).toMatch(/_attachments\/[^)\s]+\.jpg/);
    expect(vault.list().some((p) => p.startsWith('Notes/_attachments/'))).toBe(true);
  });

  test('ignores URLs that are not Outline-hosted attachments', async () => {
    const vault = new MemoryVault();
    const body = 'Outside: ![](https://imgur.com/a.png)';
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://outline.example.com',
      apiKey: 'k',
      notePath: 'Notes/Doc.md',
      body,
      fetcher: async () => ({ bytes: bytesFor(''), contentType: 'image/png' }),
    });
    expect(res.downloaded).toBe(0);
    expect(res.body).toBe(body);
  });

  test('deduplicates by URL (one download, multiple rewrites)', async () => {
    const vault = new MemoryVault();
    let calls = 0;
    const fetcher: AttachmentFetcher = async () => {
      calls++;
      return { bytes: bytesFor('PNG'), contentType: 'image/png' };
    };
    const url = 'https://outline.example.com/api/attachments.redirect?id=abc-1';
    const body = `![](${url})\n\nAgain: ![](${url})`;
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://outline.example.com',
      apiKey: 'k',
      notePath: 'Notes/Doc.md',
      body,
      fetcher,
    });
    expect(calls).toBe(1);
    expect(res.downloaded).toBe(2);
    expect(res.body.match(/_attachments\//g)?.length).toBe(2);
  });

  test('leaves body untouched when no fetcher is provided', async () => {
    const vault = new MemoryVault();
    const body = '![](https://outline.example.com/api/attachments.redirect?id=x)';
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://outline.example.com',
      apiKey: 'k',
      notePath: 'Notes/Doc.md',
      body,
    });
    expect(res.downloaded).toBe(0);
    expect(res.body).toBe(body);
  });
});
