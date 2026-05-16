/**
 * Storage backends for the LocalIndex.
 *
 * Two are provided:
 *  - {@link ObsidianIndexStorage} writes `.obsidian/plugins/<id>/index.json`
 *    via the vault adapter — same path on desktop and mobile.
 *  - {@link InMemoryIndexStorage} is for tests.
 */

import type { Plugin } from 'obsidian';
import type { IndexStorage, LocalIndexData } from './local-index';

export class InMemoryIndexStorage implements IndexStorage {
  private data: LocalIndexData | null = null;
  async read(): Promise<LocalIndexData | null> {
    return this.data ? structuredClone(this.data) : null;
  }
  async write(data: LocalIndexData): Promise<void> {
    this.data = structuredClone(data);
  }
}

export class ObsidianIndexStorage implements IndexStorage {
  private readonly plugin: Plugin;
  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private get path(): string {
    const dir = this.plugin.manifest.dir ?? `.obsidian/plugins/${this.plugin.manifest.id}`;
    return `${dir}/index.json`;
  }

  async read(): Promise<LocalIndexData | null> {
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(this.path))) return null;
    try {
      const text = await adapter.read(this.path);
      const parsed = JSON.parse(text) as LocalIndexData;
      return parsed;
    } catch {
      return null;
    }
  }

  async write(data: LocalIndexData): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    await adapter.write(this.path, JSON.stringify(data, null, 2));
  }
}
