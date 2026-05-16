import type { OutlineFrontmatter } from '../../src/pipeline';
import type { VaultIO } from '../../src/bisync/vault-io';
import { applyFrontmatterUpdates } from '../../src/frontmatter';

interface MemoryFile {
  body: string;
  frontmatter: Record<string, unknown>;
  /** Set when seeded as binary; markdown files leave this undefined. */
  binary?: ArrayBuffer;
  contentType?: string;
}

/**
 * In-memory VaultIO used by sync engine tests. Mirrors the semantics of
 * Obsidian's vault closely enough that the same engine code can drive it.
 */
export class MemoryVault implements VaultIO {
  private files = new Map<string, MemoryFile>();
  private folders = new Set<string>(['']);

  /** Pre-populate a file (raw, with optional `---` frontmatter). */
  seed(path: string, content: string): void {
    const { fm, body } = parse(content);
    this.files.set(path, { body, frontmatter: fm });
    this.addFolderChain(path);
  }

  /** Read a file as Obsidian would, with frontmatter re-attached. */
  raw(path: string): string {
    const f = this.files.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return render(f);
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  // ─── VaultIO impl ─────────────────────────────────────────────────────

  async ensureFolder(path: string): Promise<void> {
    this.folders.add(path);
    let cur = '';
    for (const seg of path.split('/')) {
      cur = cur ? `${cur}/${seg}` : seg;
      this.folders.add(cur);
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return render(f);
  }

  async write(path: string, content: string): Promise<void> {
    const { fm, body } = parse(content);
    const existing = this.files.get(path);
    // Preserve existing frontmatter if the new content has none — matches
    // Obsidian's behavior when a plugin uses processFrontMatter.
    const merged = Object.keys(fm).length ? fm : existing?.frontmatter ?? {};
    this.files.set(path, { body, frontmatter: merged });
    this.addFolderChain(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (!f) throw new Error(`Rename source missing: ${from}`);
    this.files.delete(from);
    this.files.set(to, f);
    this.addFolderChain(to);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.folders.delete(path);
  }

  async updateFrontmatter(path: string, updates: OutlineFrontmatter): Promise<void> {
    const f = this.files.get(path);
    if (!f) throw new Error(`updateFrontmatter on missing file: ${path}`);
    applyFrontmatterUpdates(f.frontmatter, updates);
  }

  async listMarkdown(root: string): Promise<string[]> {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    return [...this.files.keys()]
      .filter((p) => (p === root ? false : p.startsWith(prefix) && p.endsWith('.md')))
      .sort();
  }

  seedBinary(path: string, bytes: ArrayBuffer, contentType = 'image/png'): void {
    this.files.set(path, { body: '', frontmatter: {}, binary: bytes, contentType });
    this.addFolderChain(path);
  }

  async resolveImage(
    fromPath: string,
    imageName: string
  ): Promise<{ path: string; fileName: string; contentType: string } | null> {
    const decoded = decodeURIComponent(imageName);
    const candidates = [decoded, imageName];
    // Try absolute paths first, then relative to fromPath's folder.
    const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    for (const c of candidates) {
      if (this.files.has(c) && this.files.get(c)!.binary) return this.makeImageMeta(c);
      const rel = fromDir ? `${fromDir}/${c}` : c;
      if (this.files.has(rel) && this.files.get(rel)!.binary) return this.makeImageMeta(rel);
    }
    // Last-resort: scan by basename.
    for (const [path, file] of this.files.entries()) {
      if (file.binary && path.endsWith(`/${decoded}`)) return this.makeImageMeta(path);
      if (file.binary && path === decoded) return this.makeImageMeta(path);
    }
    return null;
  }

  private makeImageMeta(path: string): { path: string; fileName: string; contentType: string } {
    const f = this.files.get(path)!;
    const fileName = path.split('/').pop()!;
    return { path, fileName, contentType: f.contentType ?? 'application/octet-stream' };
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const f = this.files.get(path);
    if (!f?.binary) throw new Error(`No binary: ${path}`);
    return f.binary;
  }

  async writeBinary(path: string, bytes: ArrayBuffer): Promise<void> {
    const existing = this.files.get(path);
    this.files.set(path, {
      body: '',
      frontmatter: existing?.frontmatter ?? {},
      binary: bytes,
      contentType: existing?.contentType,
    });
    this.addFolderChain(path);
  }

  private addFolderChain(path: string): void {
    const idx = path.lastIndexOf('/');
    if (idx === -1) return;
    void this.ensureFolder(path.slice(0, idx));
  }
}

function parse(content: string): { fm: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { fm: {}, body: content };
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    let v: unknown = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) v = Number(v);
    if (k) fm[k] = v;
  }
  return { fm, body: content.slice(m[0].length) };
}

function render(file: MemoryFile): string {
  const keys = Object.keys(file.frontmatter);
  if (keys.length === 0) return file.body;
  const lines = keys.map((k) => `${k}: ${formatValue(file.frontmatter[k])}`);
  return `---\n${lines.join('\n')}\n---\n${file.body}`;
}

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return String(v);
}
