/**
 * Abstraction over the bits of Obsidian's vault API the sync engine needs.
 *
 * Behind this interface, tests use an in-memory fake; production uses the
 * real `App` (see {@link createObsidianVaultIO}). The same engine code runs
 * in both.
 *
 * All paths are vault-relative and forward-slashed.
 */

import type { OutlineFrontmatter } from '../pipeline';

export interface VaultIO {
  /** Create directories recursively (no-op if they exist). */
  ensureFolder(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  /** Create or overwrite a file. */
  write(path: string, content: string): Promise<void>;
  /**
   * Move a file or folder. Should propagate backlink updates when the
   * implementation supports it (Obsidian's fileManager.renameFile does).
   */
  rename(fromPath: string, toPath: string): Promise<void>;
  delete(path: string): Promise<void>;
  /**
   * Update frontmatter on an existing markdown file. Only the keys in
   * `updates` are touched.
   */
  updateFrontmatter(path: string, updates: OutlineFrontmatter): Promise<void>;
  /** List markdown files (recursively) under a folder. */
  listMarkdown(rootPath: string): Promise<string[]>;
  /**
   * Resolve an Obsidian-style image reference (wikilink target or relative
   * path) against the directory of `fromPath`. Returns `null` when the
   * image cannot be located. The returned `path` is vault-relative.
   */
  resolveImage(
    fromPath: string,
    imageName: string
  ): Promise<{ path: string; fileName: string; contentType: string } | null>;
  /** Read raw bytes from a vault file. */
  readBinary(path: string): Promise<ArrayBuffer>;
  /** Write raw bytes to a vault file (overwrites if present). */
  writeBinary(path: string, bytes: ArrayBuffer): Promise<void>;
}
