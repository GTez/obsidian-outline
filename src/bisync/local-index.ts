/**
 * Persistent index mapping Outline document IDs → vault paths.
 *
 * Lives at `.obsidian/plugins/<plugin-id>/index.json`. Read on startup,
 * written after each sync pass. The index is a *cache*: frontmatter on
 * each note is the source of truth, so a corrupt or missing index is not
 * fatal — `rebuildFromFrontmatter` walks the vault and reconstructs it.
 */

import type { OutlineSyncStatus } from '../pipeline';

export interface IndexEntry {
  outlineId: string;
  vaultPath: string;
  mappingId: string;
  parentOutlineId: string | null;
  revision: number;
  syncedHash: string;
  /** ISO timestamp of the last time this doc was seen in Outline. */
  lastSeenAt: string;
  status: OutlineSyncStatus;
}

export interface LocalIndexData {
  version: 1;
  generatedAt: string;
  /** Keyed by `outlineId`. */
  docs: Record<string, IndexEntry>;
}

/**
 * Storage seam — abstracted so the index can be persisted with Obsidian's
 * `Plugin.{loadData,saveData}` or a raw vault adapter, and the same logic
 * is testable in Node.
 */
export interface IndexStorage {
  read(): Promise<LocalIndexData | null>;
  write(data: LocalIndexData): Promise<void>;
}

export class LocalIndex {
  private data: LocalIndexData;

  private constructor(data: LocalIndexData) {
    this.data = data;
  }

  static empty(): LocalIndex {
    return new LocalIndex({
      version: 1,
      generatedAt: new Date().toISOString(),
      docs: {},
    });
  }

  static async load(storage: IndexStorage): Promise<LocalIndex> {
    const data = await storage.read();
    if (!data || data.version !== 1) return LocalIndex.empty();
    return new LocalIndex(data);
  }

  async save(storage: IndexStorage): Promise<void> {
    this.data.generatedAt = new Date().toISOString();
    await storage.write(this.data);
  }

  get(outlineId: string): IndexEntry | undefined {
    return this.data.docs[outlineId];
  }

  has(outlineId: string): boolean {
    return outlineId in this.data.docs;
  }

  /** Insert or replace an entry by `outlineId`. */
  set(entry: IndexEntry): void {
    this.data.docs[entry.outlineId] = { ...entry };
  }

  delete(outlineId: string): void {
    delete this.data.docs[outlineId];
  }

  byMapping(mappingId: string): IndexEntry[] {
    return Object.values(this.data.docs).filter((e) => e.mappingId === mappingId);
  }

  byVaultPath(vaultPath: string): IndexEntry | undefined {
    for (const entry of Object.values(this.data.docs)) {
      if (entry.vaultPath === vaultPath) return entry;
    }
    return undefined;
  }

  all(): IndexEntry[] {
    return Object.values(this.data.docs);
  }

  /** Replace the entire contents — used by rebuildFromFrontmatter. */
  replaceAll(entries: IndexEntry[]): void {
    this.data.docs = {};
    for (const e of entries) {
      this.data.docs[e.outlineId] = { ...e };
    }
  }

  raw(): LocalIndexData {
    return this.data;
  }
}
