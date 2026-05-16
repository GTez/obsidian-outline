import { readLocal } from '../src/bisync/change-detection';
import { sha256 } from '../src/bisync/hash';
import { MemoryVault } from './helpers/memory-vault';

describe('readLocal', () => {
  test('unchanged when body hash matches stored synced hash', async () => {
    const body = 'Hello world\n';
    const hash = await sha256(body);
    const vault = new MemoryVault();
    vault.seed(
      'note.md',
      `---\noutline_id: d1\noutline_synced_hash: ${hash}\n---\n${body}`
    );
    const snap = await readLocal(vault, 'note.md');
    expect(snap.changed).toBe(false);
    expect(snap.meta.outline_id).toBe('d1');
    expect(snap.body).toBe(body);
  });

  test('changed when body has been edited', async () => {
    const hash = await sha256('OLD');
    const vault = new MemoryVault();
    vault.seed(
      'note.md',
      `---\noutline_id: d1\noutline_synced_hash: ${hash}\n---\nNEW`
    );
    const snap = await readLocal(vault, 'note.md');
    expect(snap.changed).toBe(true);
  });

  test('always changed when no synced hash is stored', async () => {
    const vault = new MemoryVault();
    vault.seed('note.md', 'fresh content');
    const snap = await readLocal(vault, 'note.md');
    expect(snap.changed).toBe(true);
    expect(snap.meta.outline_id).toBeUndefined();
  });
});
