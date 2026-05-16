import { LocalIndex, type IndexEntry } from '../src/bisync/local-index';
import { InMemoryIndexStorage } from '../src/bisync/index-storage';

function makeEntry(overrides: Partial<IndexEntry>): IndexEntry {
  return {
    outlineId: 'doc-1',
    vaultPath: 'Notes/Doc.md',
    mappingId: 'm1',
    parentOutlineId: null,
    revision: 1,
    syncedHash: 'h',
    lastSeenAt: '2026-05-15T00:00:00Z',
    status: 'synced',
    ...overrides,
  };
}

describe('LocalIndex', () => {
  test('round-trips through storage', async () => {
    const storage = new InMemoryIndexStorage();
    const idx = LocalIndex.empty();
    idx.set(makeEntry({ outlineId: 'a' }));
    idx.set(makeEntry({ outlineId: 'b', vaultPath: 'Other.md' }));
    await idx.save(storage);

    const reloaded = await LocalIndex.load(storage);
    expect(reloaded.get('a')?.vaultPath).toBe('Notes/Doc.md');
    expect(reloaded.get('b')?.vaultPath).toBe('Other.md');
  });

  test('missing storage yields empty index', async () => {
    const idx = await LocalIndex.load(new InMemoryIndexStorage());
    expect(idx.all()).toHaveLength(0);
  });

  test('byMapping filters correctly', () => {
    const idx = LocalIndex.empty();
    idx.set(makeEntry({ outlineId: 'a', mappingId: 'm1' }));
    idx.set(makeEntry({ outlineId: 'b', mappingId: 'm2' }));
    idx.set(makeEntry({ outlineId: 'c', mappingId: 'm1' }));
    expect(idx.byMapping('m1').map((e) => e.outlineId).sort()).toEqual(['a', 'c']);
  });

  test('byVaultPath finds by exact path', () => {
    const idx = LocalIndex.empty();
    idx.set(makeEntry({ outlineId: 'a', vaultPath: 'X/Y.md' }));
    expect(idx.byVaultPath('X/Y.md')?.outlineId).toBe('a');
    expect(idx.byVaultPath('X/Y')).toBeUndefined();
  });

  test('delete removes the entry', () => {
    const idx = LocalIndex.empty();
    idx.set(makeEntry({ outlineId: 'a' }));
    idx.delete('a');
    expect(idx.has('a')).toBe(false);
  });
});
