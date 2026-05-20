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
    vault.seedBinary('Notes/attachments/diagram.png', bytesFor('PNG_BYTES'), 'image/png');
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

    const body = 'See diagram:\n\n![](attachments/diagram.png)\n';
    const res = await processOutboundImages({
      vault,
      api,
      notePath: 'Notes/Doc.md',
      body,
      documentId: 'd1',
    });
    expect(res.uploaded).toBe(1);
    expect(res.body).toContain('![diagram](https://outline.example.com/api/attachments.redirect?id=att-1)');
    expect(res.body).not.toContain('attachments/diagram.png');
  });

  test('reuses cached URL when bytes are unchanged (no upload)', async () => {
    const vault = new MemoryVault();
    const pngBytes = bytesFor('PNG_STABLE');
    vault.seedBinary('Notes/attachments/diagram.png', pngBytes, 'image/png');
    const api = new FakeApi();

    let uploads = 0;
    api.createAttachment = async () => {
      uploads++;
      return {
        uploadUrl: 'https://o.example/api/files',
        form: { key: 'k' },
        attachment: { url: 'https://o.example/api/attachments.redirect?id=NEW' },
      };
    };
    api.uploadAttachmentToStorage = async () => true;

    const body = '![](attachments/diagram.png)';
    // Compute the content hash exactly as the production code will.
    const { sha256Bytes } = await import('../src/bisync/hash');
    const h = await sha256Bytes(pngBytes);
    const prior = {
      'Notes/attachments/diagram.png': {
        u: 'https://o.example/api/attachments.redirect?id=OLD',
        h,
      },
    };
    const res = await processOutboundImages({
      vault,
      api,
      notePath: 'Notes/Doc.md',
      body,
      documentId: 'd1',
      priorMap: prior,
    });
    expect(uploads).toBe(0);
    expect(res.reused).toBe(1);
    expect(res.body).toContain('?id=OLD'); // kept the cached URL
    expect(res.map['Notes/attachments/diagram.png'].u).toContain('?id=OLD');
  });

  test('re-uploads when bytes change (hash mismatch)', async () => {
    const vault = new MemoryVault();
    vault.seedBinary('Notes/attachments/diagram.png', bytesFor('NEW_BYTES'), 'image/png');
    const api = new FakeApi();
    let uploads = 0;
    api.createAttachment = async () => {
      uploads++;
      return {
        uploadUrl: 'https://o.example/api/files',
        form: { key: 'k' },
        attachment: { url: 'https://o.example/api/attachments.redirect?id=FRESH' },
      };
    };
    api.uploadAttachmentToStorage = async () => true;

    const prior = {
      'Notes/attachments/diagram.png': {
        u: 'https://o.example/api/attachments.redirect?id=STALE',
        h: 'wrong-hash',
      },
    };
    const res = await processOutboundImages({
      vault,
      api,
      notePath: 'Notes/Doc.md',
      body: '![](attachments/diagram.png)',
      documentId: 'd1',
      priorMap: prior,
    });
    expect(uploads).toBe(1);
    expect(res.uploaded).toBe(1);
    expect(res.reused).toBe(0);
    expect(res.body).toContain('?id=FRESH');
  });

  test('prunes map entries for images no longer referenced', async () => {
    const vault = new MemoryVault();
    vault.seedBinary('Notes/attachments/kept.png', bytesFor('KEEP'), 'image/png');
    const api = new FakeApi();
    api.createAttachment = async () => ({
      uploadUrl: 'https://o.example/api/files',
      form: { key: 'k' },
      attachment: { url: 'https://o.example/api/attachments.redirect?id=KEPT' },
    });
    api.uploadAttachmentToStorage = async () => true;
    const prior = {
      'Notes/attachments/removed.png': {
        u: 'https://o.example/api/attachments.redirect?id=DROP',
        h: 'h',
      },
    };
    const res = await processOutboundImages({
      vault,
      api,
      notePath: 'Notes/Doc.md',
      body: '![](attachments/kept.png)', // only references kept.png
      documentId: 'd1',
      priorMap: prior,
    });
    expect(Object.keys(res.map)).toEqual(['Notes/attachments/kept.png']);
    expect(res.map['Notes/attachments/kept.png'].u).toContain('?id=KEPT');
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
    // Note is at Notes/Doc.md → ../Extras/Outline-Sync/Attachments/
    expect(res.body).toContain('../Extras/Outline-Sync/Attachments/');
    expect(res.body).toMatch(/Attachments\/[^)\s]+\.jpg/);
    expect(
      vault.list().some((p) => p.startsWith('Extras/Outline-Sync/Attachments/'))
    ).toBe(true);
  });

  test('downloads host-relative attachment URLs (the original bug)', async () => {
    const vault = new MemoryVault();
    let fetchedUrl = '';
    const fetcher: AttachmentFetcher = async (url) => {
      fetchedUrl = url;
      return { bytes: bytesFor('PNG'), contentType: 'image/png' };
    };
    const body =
      '![](/api/attachments.redirect?id=4741efca-a335-43a6-a657-66d29296e47a)';
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://outline.example.com',
      apiKey: 'k',
      notePath: 'Notes/Doc.md',
      body,
      fetcher,
    });
    expect(res.downloaded).toBe(1);
    // Relative URL was resolved against outlineUrl before fetching.
    expect(fetchedUrl).toBe(
      'https://outline.example.com/api/attachments.redirect?id=4741efca-a335-43a6-a657-66d29296e47a'
    );
    expect(res.body).not.toContain('/api/attachments.redirect');
    expect(res.body).toMatch(
      /!\[\]\(\.\.\/Extras\/Outline-Sync\/Attachments\/4741efca-[^)]+\.png\)/
    );
  });

  test('strips title and translates =WxH size to Obsidian pipe syntax', async () => {
    const vault = new MemoryVault();
    const fetcher: AttachmentFetcher = async () => ({
      bytes: bytesFor('PNG'),
      contentType: 'image/png',
    });
    const body =
      '![](/api/attachments.redirect?id=img-1 "right-50 =304x171")';
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://outline.example.com',
      apiKey: 'k',
      notePath: 'Notes/Doc.md',
      body,
      fetcher,
    });
    expect(res.downloaded).toBe(1);
    expect(res.body).not.toContain('right-50');
    expect(res.body).not.toContain('"');
    expect(res.body).toMatch(/!\[\|304x171\]\(/);
  });

  test('strips title with no size hint, leaves alt untouched', async () => {
    const vault = new MemoryVault();
    const fetcher: AttachmentFetcher = async () => ({
      bytes: bytesFor('PNG'),
      contentType: 'image/png',
    });
    const body =
      '![diagram](/api/attachments.redirect?id=img-2 "just a caption")';
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://outline.example.com',
      apiKey: 'k',
      notePath: 'Notes/Doc.md',
      body,
      fetcher,
    });
    expect(res.downloaded).toBe(1);
    expect(res.body).not.toContain('just a caption');
    expect(res.body).toMatch(/!\[diagram\]\(/);
  });

  test('honors a custom attachmentsPath and computes path relative to the note', async () => {
    const vault = new MemoryVault();
    const fetcher: AttachmentFetcher = async () => ({
      bytes: bytesFor('PNG'),
      contentType: 'image/png',
    });
    const body = '![](https://o.example/api/attachments.redirect?id=deep)';
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://o.example',
      apiKey: 'k',
      notePath: 'Work/Subfolder/Doc.md',
      body,
      fetcher,
      attachmentsPath: 'Assets/Images',
    });
    expect(res.downloaded).toBe(1);
    // Doc at Work/Subfolder/Doc.md → ../../Assets/Images/
    expect(res.body).toContain('../../Assets/Images/');
    expect(vault.list().some((p) => p.startsWith('Assets/Images/'))).toBe(true);
  });

  test('note at the vault root produces a relative ref without ../', async () => {
    const vault = new MemoryVault();
    const fetcher: AttachmentFetcher = async () => ({
      bytes: bytesFor('PNG'),
      contentType: 'image/png',
    });
    const body = '![](/api/attachments.redirect?id=root)';
    const res = await processInboundAttachments({
      vault,
      outlineUrl: 'https://o.example',
      apiKey: 'k',
      notePath: 'Doc.md',
      body,
      fetcher,
    });
    expect(res.downloaded).toBe(1);
    expect(res.body).toMatch(/!\[\]\(Extras\/Outline-Sync\/Attachments\//);
    expect(res.body).not.toContain('../');
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
    expect(res.body.match(/Extras\/Outline-Sync\/Attachments\//g)?.length).toBe(2);
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
