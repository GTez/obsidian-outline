import {
  conflictPathFor,
  hasUnresolvedConflict,
  writeConflictFile,
} from '../src/bisync/conflict';
import { reconcileMapping } from '../src/bisync/reconciler';
import { LocalIndex } from '../src/bisync/local-index';
import { sha256 } from '../src/bisync/hash';
import type { OutlineNode } from '../src/bisync/hierarchy';
import type { SyncMapping } from '../src/settings';
import { FakeApi } from './helpers/fake-api';
import { MemoryVault } from './helpers/memory-vault';

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

function leaf(id: string, title: string, text: string, revision: number): OutlineNode {
  return {
    id,
    title,
    parentId: null,
    collectionId: 'c1',
    children: [],
    text,
    revision,
    urlId: id + 'Short',
  };
}

describe('conflictPathFor', () => {
  test('is deterministic from path + timestamp', () => {
    const ts = new Date('2026-05-16T12:34:56.789Z');
    expect(conflictPathFor('Work/Note.md', ts)).toBe(
      'Work/Note.outline-conflict-2026-05-16T12-34-56-789.md'
    );
  });
  test('handles root-level files', () => {
    expect(conflictPathFor('A.md', new Date('2026-05-16T00:00:00Z'))).toBe(
      'A.outline-conflict-2026-05-16T00-00-00-000.md'
    );
  });
});

describe('writeConflictFile', () => {
  test('writes remote body with conflict_for + outline_revision frontmatter', async () => {
    const vault = new MemoryVault();
    vault.seed('Work/Note.md', 'local edited body');
    const remote = leaf('d1', 'Note', 'remote body', 7);
    const path = await writeConflictFile({
      vault,
      localPath: 'Work/Note.md',
      remote,
      now: () => new Date('2026-05-16T12:34:56.789Z'),
    });
    expect(path).toBe('Work/Note.outline-conflict-2026-05-16T12-34-56-789.md');
    const raw = vault.raw(path);
    expect(raw).toContain('remote body');
    expect(raw).toContain('outline_id: d1');
    expect(raw).toContain('outline_revision: 7');
    expect(raw).toContain('conflict_for: Work/Note.md');
  });
});

describe('hasUnresolvedConflict', () => {
  test('returns true when sibling conflict file exists', async () => {
    const vault = new MemoryVault();
    vault.seed('Work/Note.md', 'local');
    vault.seed('Work/Note.outline-conflict-2026-05-16T00-00-00-000.md', 'remote');
    expect(await hasUnresolvedConflict(vault, 'Work/Note.md')).toBe(true);
  });
  test('returns false when nothing is in flight', async () => {
    const vault = new MemoryVault();
    vault.seed('Work/Note.md', 'local');
    expect(await hasUnresolvedConflict(vault, 'Work/Note.md')).toBe(false);
  });
});

describe('end-to-end conflict flow', () => {
  test('first pass writes conflict file; second pass skips while it exists; third pass after deletion pushes the resolved local', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const oldHash = await sha256('original');
    vault.seed(
      'Work/Note.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 1\noutline_synced_hash: ${oldHash}\noutline_title: Note\n---\nLOCAL EDIT`
    );
    api.seed({ id: 'd1', title: 'Note', text: 'REMOTE EDIT', collectionId: 'c1', revision: 2 });
    const remote = leaf('d1', 'Note', 'REMOTE EDIT', 2);

    const run = (): ReturnType<typeof reconcileMapping> =>
      reconcileMapping({
        vault,
        api,
        mapping: makeMapping(),
        roots: [remote],
        index: LocalIndex.empty(),
        outlineUrl: 'https://o.example',
        conflictBehavior: 'create-conflict-file',
      });

    // Pass 1 — detected, conflict file written.
    const r1 = await run();
    expect(r1.events.map((e) => e.action)).toContain('conflict');
    const conflictFiles = vault.list().filter((p) => p.includes('outline-conflict-'));
    expect(conflictFiles).toHaveLength(1);
    expect(vault.raw('Work/Note.md')).toContain('outline_sync_status: conflict');

    // Pass 2 — should skip while conflict file still exists.
    const r2 = await run();
    const skipped = r2.events.find((e) => e.action === 'skipped');
    expect(skipped).toBeDefined();
    expect(skipped?.message).toContain('unresolved');

    // User resolves: deletes conflict file, leaves local as the merged result.
    await vault.delete(conflictFiles[0]);

    // Pass 3 — local body now differs from synced hash, remote unchanged → push.
    const r3 = await run();
    expect(r3.events.map((e) => e.action)).toContain('pushed');
    expect(api.updatedRequests).toHaveLength(1);
    expect(api.updatedRequests[0].text).toBe('LOCAL EDIT');
  });
});
