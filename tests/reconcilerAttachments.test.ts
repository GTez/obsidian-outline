import { reconcileMapping } from '../src/bisync/reconciler';
import { LocalIndex } from '../src/bisync/local-index';
import { sha256 } from '../src/bisync/hash';
import type { OutlineNode } from '../src/bisync/hierarchy';
import type { SyncMapping } from '../src/settings';
import type { AttachmentFetcher } from '../src/bisync/attachments';
import { FakeApi } from './helpers/fake-api';
import { MemoryVault } from './helpers/memory-vault';

function bytesFor(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

function mapping(): SyncMapping {
  return {
    id: 'm1',
    source: {
      type: 'document',
      outlineId: 'root',
      displayName: 'Root',
      lastResolvedAt: '2026-05-15T00:00:00Z',
    },
    vaultPath: 'Work',
    includeRoot: true,
    enabled: true,
    lastFullSyncAt: null,
  };
}

function leaf(
  id: string,
  title: string,
  text: string,
  revision = 1,
  parentId: string | null = null
): OutlineNode {
  return {
    id,
    title,
    parentId,
    collectionId: 'c1',
    children: [],
    text,
    revision,
    urlId: id + 'Short',
  };
}

describe('reconciler + attachments', () => {
  test('pulling brings down an Outline-hosted image into the vault', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const remoteBody =
      'Diagram below:\n\n![](https://o.example/api/attachments.redirect?id=img-1)\n';
    const fetcher: AttachmentFetcher = async () => ({
      bytes: bytesFor('PNG_BYTES'),
      contentType: 'image/png',
    });
    const result = await reconcileMapping({
      vault,
      api,
      mapping: mapping(),
      roots: [leaf('d1', 'Note', remoteBody)],
      index: LocalIndex.empty(),
      outlineUrl: 'https://o.example',
      conflictBehavior: 'create-conflict-file',
      attachmentFetcher: fetcher,
      apiKey: 'k',
    });
    expect(result.events.map((e) => e.action)).toContain('created-local');
    const localRaw = vault.raw('Work/Note.md');
    expect(localRaw).toContain('_attachments/');
    expect(localRaw).not.toContain('attachments.redirect');
    // Binary file actually present in the vault.
    const downloaded = vault
      .list()
      .filter((p) => p.startsWith('Work/_attachments/'));
    expect(downloaded.length).toBe(1);
  });

  test('pushing uploads a local image referenced in the body', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();

    // Patch api to fake the upload pipeline. The real Outline returns
    // {uploadUrl, form, attachment.url}; we mimic that.
    api.createAttachment = async () => ({
      uploadUrl: 'https://o.example/api/files',
      form: { key: 'k' },
      attachment: { url: 'https://o.example/api/attachments.redirect?id=att-1' },
    });
    api.uploadAttachmentToStorage = async () => true;

    vault.seedBinary('Work/_attachments/diagram.png', bytesFor('PNG'), 'image/png');
    const oldBody = 'Look at this:\n\n![](_attachments/diagram.png)';
    const oldHash = await sha256(oldBody);
    vault.seed(
      'Work/Note.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 1\noutline_synced_hash: ${oldHash}\noutline_title: Note\n---\nLook at this:\n\n![](_attachments/diagram.png)\n\nAnd more text.`
    );
    const remote: OutlineNode = leaf('d1', 'Note', 'old', 1);
    api.seed({ id: 'd1', title: 'Note', text: 'old', collectionId: 'c1', revision: 1 });
    const result = await reconcileMapping({
      vault,
      api,
      mapping: mapping(),
      roots: [remote],
      index: LocalIndex.empty(),
      outlineUrl: 'https://o.example',
      conflictBehavior: 'create-conflict-file',
      apiKey: 'k',
    });
    expect(result.events.map((e) => e.action)).toContain('pushed');
    // Outline received the rewritten body.
    expect(api.updatedRequests[0].text).toContain(
      'https://o.example/api/attachments.redirect?id=att-1'
    );
    expect(api.updatedRequests[0].text).not.toContain('_attachments/diagram.png');
    // Local body still references the local path.
    expect(vault.raw('Work/Note.md')).toContain('![](_attachments/diagram.png)');
  });
});
