import { BisyncEngine } from '../src/bisync/engine';
import { InMemoryIndexStorage } from '../src/bisync/index-storage';
import type { OutlineSyncSettings, SyncMapping } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/settings';
import { FakeApi } from './helpers/fake-api';
import { MemoryVault } from './helpers/memory-vault';

function settings(over: Partial<OutlineSyncSettings> = {}): OutlineSyncSettings {
  return { ...DEFAULT_SETTINGS, outlineUrl: 'https://o.example', ...over };
}

function mapping(over: Partial<SyncMapping> = {}): SyncMapping {
  return {
    id: 'm1',
    source: {
      type: 'document',
      outlineId: 'root',
      displayName: 'Engineering',
      lastResolvedAt: '2026-05-15T00:00:00Z',
    },
    vaultPath: 'Work',
    includeRoot: true,
    enabled: true,
    lastFullSyncAt: null,
    ...over,
  };
}

describe('BisyncEngine', () => {
  test('syncAll fans out across enabled mappings and skips disabled ones', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    api.seed({
      id: 'root',
      title: 'Engineering',
      text: 'eng body',
      collectionId: 'c1',
      revision: 1,
    });

    const config: OutlineSyncSettings = settings({
      mappings: [mapping({ id: 'm1' }), mapping({ id: 'm2', enabled: false })],
    });
    const engine = new BisyncEngine({
      api,
      vault,
      indexStorage: new InMemoryIndexStorage(),
      getSettings: () => config,
    });
    const results = await engine.syncAll();
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(vault.raw('Work/Engineering.md')).toContain('eng body');
  });

  test('resolveSource takes a URL and returns the resolved doc', async () => {
    const api = new FakeApi();
    api.seed({
      id: 'docxyz123',
      title: 'My Doc',
      text: '',
      collectionId: 'c1',
      revision: 1,
    });
    const engine = new BisyncEngine({
      api,
      vault: new MemoryVault(),
      indexStorage: new InMemoryIndexStorage(),
      getSettings: () => settings(),
    });
    const res = await engine.resolveSource('https://o.example/doc/my-doc-docxyz123');
    expect(res).toEqual({ type: 'document', outlineId: 'docxyz123', displayName: 'My Doc' });
  });

  test('rebuildIndex extracts entries from frontmatter', async () => {
    const vault = new MemoryVault();
    vault.seed(
      'Work/Note.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 7\noutline_synced_hash: abc\noutline_title: Note\n---\nbody`
    );
    const storage = new InMemoryIndexStorage();
    const engine = new BisyncEngine({
      api: new FakeApi(),
      vault,
      indexStorage: storage,
      getSettings: () => settings({ mappings: [mapping()] }),
    });
    await engine.rebuildIndex();
    const data = await storage.read();
    expect(data?.docs['d1']).toMatchObject({
      outlineId: 'd1',
      vaultPath: 'Work/Note.md',
      revision: 7,
      syncedHash: 'abc',
    });
  });
});
