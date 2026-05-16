import { pullMapping } from '../src/bisync/puller';
import type { OutlineNode } from '../src/bisync/hierarchy';
import { LocalIndex } from '../src/bisync/local-index';
import { sha256 } from '../src/bisync/hash';
import type { SyncMapping } from '../src/settings';
import { MemoryVault } from './helpers/memory-vault';

function leaf(id: string, title: string, text: string, parentId: string | null = null): OutlineNode {
  return {
    id,
    title,
    parentId,
    collectionId: 'c1',
    children: [],
    text,
    revision: 1,
    urlId: id + 'Short',
  };
}

function makeMapping(): SyncMapping {
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

describe('pullMapping', () => {
  test('writes a folder-note layout to an empty vault', async () => {
    const vault = new MemoryVault();
    const root: OutlineNode = {
      id: 'root',
      title: 'Engineering',
      parentId: null,
      collectionId: 'c1',
      children: [leaf('child', 'Runbooks', '# Runbooks body', 'root')],
      text: '# Engineering body',
      revision: 5,
      urlId: 'engShort',
    };
    const index = LocalIndex.empty();
    const result = await pullMapping({
      vault,
      mapping: makeMapping(),
      roots: [root],
      outlineUrl: 'https://outline.example.com',
      index,
    });
    expect(result.errors).toEqual([]);
    expect(result.written.sort()).toEqual([
      'Work/Engineering/Engineering.md',
      'Work/Engineering/Runbooks.md',
    ]);
    // Body preserved verbatim.
    const raw = vault.raw('Work/Engineering/Engineering.md');
    expect(raw).toContain('# Engineering body');
    expect(raw).toContain('outline_id: root');
    expect(raw).toContain('outline_revision: 5');
    expect(raw).toContain('outline_url: https://outline.example.com/doc/engShort');
  });

  test('stamps the synced hash to the body Outline returned', async () => {
    const vault = new MemoryVault();
    const body = 'Hello canonical world\n';
    const node = leaf('a', 'Alpha', body);
    const index = LocalIndex.empty();
    await pullMapping({
      vault,
      mapping: makeMapping(),
      roots: [node],
      outlineUrl: 'https://o',
      index,
    });
    const expected = await sha256(body);
    const entry = index.get('a');
    expect(entry?.syncedHash).toBe(expected);
  });
});
