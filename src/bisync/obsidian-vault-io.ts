/**
 * Obsidian implementation of {@link VaultIO}.
 *
 * Uses `app.vault` for raw IO and `app.fileManager.renameFile` for moves
 * (the latter is critical — it's what triggers backlink updates).
 *
 * All paths are vault-relative, forward-slashed, no leading slash. Same
 * convention as Obsidian itself.
 */

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { updateOutlineFrontmatter } from '../frontmatter';
import type { OutlineFrontmatter } from '../pipeline';
import { getContentType } from '../utils/content-type';
import type { VaultIO } from './vault-io';

export class ObsidianVaultIO implements VaultIO {
  constructor(private readonly app: App) {}

  async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    const np = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(np);
    if (existing instanceof TFolder) return;
    // createFolder is recursive in modern Obsidian; older versions need us to
    // build up segment by segment. Try the simple path first.
    try {
      await this.app.vault.createFolder(np);
    } catch {
      let cur = '';
      for (const seg of np.split('/')) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (!this.app.vault.getAbstractFileByPath(cur)) {
          await this.app.vault.createFolder(cur);
        }
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }

  async read(path: string): Promise<string> {
    const file = this.getMarkdown(path);
    return this.app.vault.read(file);
  }

  async write(path: string, content: string): Promise<void> {
    const np = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(np);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return;
    }
    const dir = directoryOf(np);
    if (dir) await this.ensureFolder(dir);
    await this.app.vault.create(np, content);
  }

  async rename(from: string, to: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(from));
    if (!file) throw new Error(`Rename source missing: ${from}`);
    const targetDir = directoryOf(normalizePath(to));
    if (targetDir) await this.ensureFolder(targetDir);
    await this.app.fileManager.renameFile(file, normalizePath(to));
  }

  async delete(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!file) return;
    await this.app.vault.delete(file);
  }

  async updateFrontmatter(path: string, updates: OutlineFrontmatter): Promise<void> {
    const file = this.getMarkdown(path);
    await updateOutlineFrontmatter(this.app, file, updates);
  }

  async listMarkdown(rootPath: string): Promise<string[]> {
    const np = normalizePath(rootPath);
    const root = this.app.vault.getAbstractFileByPath(np);
    if (!(root instanceof TFolder)) return [];
    const out: string[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === 'md') out.push(child.path);
        else if (child instanceof TFolder) walk(child);
      }
    };
    walk(root);
    return out;
  }

  async resolveImage(
    fromPath: string,
    imageName: string
  ): Promise<{ path: string; fileName: string; contentType: string } | null> {
    const decoded = decodeURIComponent(imageName);
    const image =
      this.app.metadataCache.getFirstLinkpathDest(decoded, fromPath) ??
      this.app.vault.getAbstractFileByPath(decoded) ??
      this.app.vault.getAbstractFileByPath(imageName);
    if (!(image instanceof TFile)) return null;
    return {
      path: image.path,
      fileName: image.name,
      contentType: getContentType(image.extension),
    };
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`Not a file: ${path}`);
    return this.app.vault.readBinary(file);
  }

  async writeBinary(path: string, bytes: ArrayBuffer): Promise<void> {
    const np = normalizePath(path);
    const dir = directoryOf(np);
    if (dir) await this.ensureFolder(dir);
    const existing = this.app.vault.getAbstractFileByPath(np);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, bytes);
      return;
    }
    await this.app.vault.createBinary(np, bytes);
  }

  private getMarkdown(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`Not a file: ${path}`);
    return file;
  }
}

function directoryOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}
