import { reconcileMapping } from '../src/bisync/reconciler';
import type { OutlineNode } from '../src/bisync/hierarchy';
import { LocalIndex } from '../src/bisync/local-index';
import { sha256 } from '../src/bisync/hash';
import type { SyncMapping } from '../src/settings';
import { FakeApi } from './helpers/fake-api';
import { MemoryVault } from './helpers/memory-vault';

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

function makeMapping(over: Partial<SyncMapping> = {}): SyncMapping {
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
    ...over,
  };
}

async function runReconcile(
  vault: MemoryVault,
  api: FakeApi,
  roots: OutlineNode[],
  over: Parameters<typeof reconcileMapping>[0] extends infer P
    ? Partial<Omit<P, 'vault' | 'api' | 'roots' | 'mapping' | 'index'>>
    : never = {}
) {
  return reconcileMapping({
    vault,
    api,
    mapping: makeMapping(),
    roots,
    index: LocalIndex.empty(),
    outlineUrl: 'https://o.example',
    conflictBehavior: 'create-conflict-file',
    ...over,
  });
}

describe('reconcileMapping', () => {
  test('creates local files for remote-only docs', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const root: OutlineNode = {
      id: 'root',
      title: 'Engineering',
      parentId: null,
      collectionId: 'c1',
      children: [leaf('child', 'Runbooks', 'rb body', 1, 'root')],
      text: 'eng body',
      revision: 1,
      urlId: 'engShort',
    };
    const result = await runReconcile(vault, api, [root]);
    const actions = result.events.map((e) => e.action).sort();
    expect(actions).toEqual(['created-local', 'created-local']);
    expect(vault.raw('Work/Engineering/Engineering.md')).toContain('eng body');
    expect(vault.raw('Work/Engineering/Engineering.md')).toContain('outline_id: root');
  });

  test('pushes when local body changed but remote did not', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    api.seed({ id: 'd1', title: 'Note', text: 'old\n', collectionId: 'c1', revision: 3 });

    const oldHash = await sha256('old\n');
    vault.seed(
      'Work/Note.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 3\noutline_synced_hash: ${oldHash}\noutline_title: Note\n---\nbrand new content`
    );

    const node = leaf('d1', 'Note', 'old\n', 3);
    const result = await runReconcile(vault, api, [node]);
    expect(result.events.map((e) => e.action)).toContain('pushed');
    expect(api.updatedRequests).toHaveLength(1);
    expect(api.updatedRequests[0].text).toBe('brand new content');
    // After push, local body should match server canonical form.
    expect(vault.raw('Work/Note.md')).toContain('brand new content\n');
  });

  test('pulls when remote revision advanced and local unchanged', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const oldBody = 'v1 body';
    const oldHash = await sha256(oldBody);
    vault.seed(
      'Work/Note.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 1\noutline_synced_hash: ${oldHash}\noutline_title: Note\n---\n${oldBody}`
    );
    // Remote moved to revision 2 with new body.
    const node = leaf('d1', 'Note', 'v2 body', 2);
    const result = await runReconcile(vault, api, [node]);
    expect(result.events.map((e) => e.action)).toContain('pulled');
    expect(vault.raw('Work/Note.md')).toContain('v2 body');
    expect(vault.raw('Work/Note.md')).toContain('outline_revision: 2');
  });

  test('noop when nothing changed', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const body = 'steady\n';
    const hash = await sha256(body);
    vault.seed(
      'Work/Note.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 5\noutline_synced_hash: ${hash}\noutline_title: Note\n---\n${body}`
    );
    const node = leaf('d1', 'Note', body, 5);
    const result = await runReconcile(vault, api, [node]);
    expect(result.events.map((e) => e.action)).toEqual(['noop']);
  });

  test('orphans a local file whose Outline doc left the subtree', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const body = 'orphan body\n';
    const hash = await sha256(body);
    vault.seed(
      'Work/Stale.md',
      `---\noutline_id: gone\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 1\noutline_synced_hash: ${hash}\noutline_title: Stale\n---\n${body}`
    );
    const result = await runReconcile(vault, api, []);
    const orphan = result.events.find((e) => e.action === 'orphaned');
    expect(orphan).toBeDefined();
    expect(vault.raw('Work/Stale.md')).toContain('outline_sync_status: orphaned');
  });

  test('renames when Outline title changed', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const body = 'body\n';
    const hash = await sha256(body);
    vault.seed(
      'Work/Old.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 1\noutline_synced_hash: ${hash}\noutline_title: Old\n---\n${body}`
    );
    const node = leaf('d1', 'New Title', body, 1);
    const result = await runReconcile(vault, api, [node]);
    const renamed = result.events.find((e) => e.action === 'renamed');
    expect(renamed?.vaultPath).toBe('Work/New Title.md');
    expect(vault.list()).toContain('Work/New Title.md');
    expect(vault.list()).not.toContain('Work/Old.md');
  });

  test('conflict mode "create-conflict-file" defers to handler and marks status', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const oldHash = await sha256('old');
    vault.seed(
      'Work/Note.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 1\noutline_synced_hash: ${oldHash}\noutline_title: Note\n---\nLOCAL EDIT`
    );
    const node = leaf('d1', 'Note', 'REMOTE EDIT', 2);
    let handlerCalled = false;
    const result = await runReconcile(vault, api, [node], {
      handleConflict: async () => {
        handlerCalled = true;
        return { handled: true };
      },
    });
    expect(handlerCalled).toBe(true);
    const conflict = result.events.find((e) => e.action === 'conflict');
    expect(conflict).toBeDefined();
    expect(vault.raw('Work/Note.md')).toContain('outline_sync_status: conflict');
  });

  test('prefer-remote overwrites local on conflict', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    const oldHash = await sha256('old');
    vault.seed(
      'Work/Note.md',
      `---\noutline_id: d1\noutline_collection_id: c1\noutline_mapping_id: m1\noutline_revision: 1\noutline_synced_hash: ${oldHash}\noutline_title: Note\n---\nLOCAL EDIT`
    );
    const node = leaf('d1', 'Note', 'REMOTE WINS', 2);
    const result = await runReconcile(vault, api, [node], {
      conflictBehavior: 'prefer-remote',
    });
    expect(result.events.map((e) => e.action)).toContain('pulled');
    expect(vault.raw('Work/Note.md')).toContain('REMOTE WINS');
  });

  test('pushNewLocal creates an Outline doc for files lacking outline_id', async () => {
    const vault = new MemoryVault();
    const api = new FakeApi();
    vault.seed('Work/Fresh.md', 'first draft body');
    const root: OutlineNode = {
      id: 'root',
      title: 'Engineering',
      parentId: null,
      collectionId: 'c1',
      children: [],
      text: 'eng body',
      revision: 1,
    };
    const result = await runReconcile(vault, api, [root], { pushNewLocal: true });
    expect(api.createdRequests).toHaveLength(1);
    expect(api.createdRequests[0].title).toBe('Fresh');
    const created = result.events.find((e) => e.action === 'created-remote');
    expect(created).toBeDefined();
    expect(vault.raw('Work/Fresh.md')).toContain('outline_id: doc-');
  });
});
