/**
 * Attachment handling for the bidirectional reconciler.
 *
 * Two operations:
 *
 *  - {@link processOutboundImages}: takes a local-body about to be pushed,
 *    detects image refs, uploads each to Outline, returns a body where
 *    the refs have been replaced with Outline attachment URLs.
 *
 *  - {@link processInboundAttachments}: takes a remote body just pulled
 *    from Outline, finds attachment URLs hosted on the configured Outline
 *    instance, downloads each into the vault, and returns a body where
 *    the refs have been replaced with local relative paths.
 *
 * Both rely on the existing image-detection regex in
 * `pipeline/transformers/images.ts` for the outbound side; the inbound
 * side has its own URL scanner because Outline's stored markdown uses
 * standard `![alt](url)` syntax with absolute URLs.
 */

import { detectImages } from '../pipeline';
import type { IOutlineApi } from '../outline-api/types';
import { sha256Bytes } from './hash';
import type { VaultIO } from './vault-io';

// ─── Outbound (push) ───────────────────────────────────────────────────

/**
 * Per-note record of which local image refs map to which Outline
 * attachment URLs, plus a content hash so we can re-upload only when the
 * bytes actually change.
 *
 * The shape is intentionally terse (`u`, `h`) because it lives inside
 * frontmatter (as a JSON-stringified value) and shorter keys keep the
 * YAML readable.
 */
export type AttachmentMapEntry = { u: string; h: string };
export type AttachmentMap = Record<string, AttachmentMapEntry>;

export function parseAttachmentMap(serialized: string | null | undefined): AttachmentMap {
  if (!serialized) return {};
  try {
    const parsed = JSON.parse(serialized);
    if (parsed && typeof parsed === 'object') return parsed as AttachmentMap;
  } catch {
    // Fallthrough.
  }
  return {};
}

export function serializeAttachmentMap(map: AttachmentMap): string {
  return JSON.stringify(map);
}

export interface ProcessOutboundOptions {
  vault: VaultIO;
  api: IOutlineApi;
  notePath: string;
  body: string;
  /** Outline doc id to associate uploads with. */
  documentId: string;
  /** Map of previously-uploaded images. Hash check decides whether to re-upload. */
  priorMap?: AttachmentMap;
}

export interface ProcessOutboundResult {
  body: string;
  /** Map containing only entries for images still referenced in the body. */
  map: AttachmentMap;
  /** Images that triggered an actual upload this pass. */
  uploaded: number;
  /** Images that hit the cache (no upload, just rewrite). */
  reused: number;
  total: number;
}

export async function processOutboundImages(
  opts: ProcessOutboundOptions
): Promise<ProcessOutboundResult> {
  const detected = detectImages(opts.body);
  const prior = opts.priorMap ?? {};
  const next: AttachmentMap = {};
  if (detected.images.length === 0) {
    return { body: opts.body, map: next, uploaded: 0, reused: 0, total: 0 };
  }
  let body = opts.body;
  let uploaded = 0;
  let reused = 0;
  for (const ref of detected.images) {
    const resolved = await opts.vault.resolveImage(opts.notePath, ref.imageName);
    if (!resolved) {
      body = body.replace(ref.originalSyntax, `*(Image not found: ${ref.imageName})*`);
      continue;
    }
    const bytes = await opts.vault.readBinary(resolved.path);
    const contentHash = await sha256Bytes(bytes);
    const cached = prior[resolved.path];
    if (cached && cached.h === contentHash) {
      // Same bytes as last time → reuse the URL Outline already has.
      const alt = resolved.fileName.replace(/\.[^.]+$/, '');
      body = body.replace(ref.originalSyntax, `![${alt}](${cached.u})`);
      next[resolved.path] = cached;
      reused++;
      continue;
    }
    const attachment = await opts.api.createAttachment({
      name: resolved.fileName,
      contentType: resolved.contentType,
      size: bytes.byteLength,
      documentId: opts.documentId,
    });
    if (!attachment?.uploadUrl || !attachment.form) {
      body = body.replace(ref.originalSyntax, `*(Upload failed: ${resolved.fileName})*`);
      continue;
    }
    const ok = await opts.api.uploadAttachmentToStorage(
      attachment.uploadUrl,
      attachment.form,
      bytes,
      resolved.contentType
    );
    if (!ok) {
      body = body.replace(ref.originalSyntax, `*(Upload failed: ${resolved.fileName})*`);
      continue;
    }
    const alt = resolved.fileName.replace(/\.[^.]+$/, '');
    const url = attachment.attachment?.url ?? '';
    body = body.replace(ref.originalSyntax, `![${alt}](${url})`);
    next[resolved.path] = { u: url, h: contentHash };
    uploaded++;
  }
  return { body, map: next, uploaded, reused, total: detected.images.length };
}

// ─── Inbound (pull) ────────────────────────────────────────────────────

export interface ProcessInboundOptions {
  vault: VaultIO;
  outlineUrl: string;
  apiKey: string;
  /** Path of the markdown file the body belongs to. Attachments are placed in a sibling folder. */
  notePath: string;
  body: string;
  /**
   * Where attachments live, relative to the note's directory.
   * Default: `attachments`. (Avoid leading `_` — Remotely Save and similar
   * tools skip underscore-prefixed folders by default.)
   */
  attachmentsFolder?: string;
  /** Test seam — override the HTTP fetcher. */
  fetcher?: AttachmentFetcher;
}

export interface ProcessInboundResult {
  body: string;
  downloaded: number;
  total: number;
}

export type AttachmentFetcher = (
  url: string,
  apiKey: string
) => Promise<{ bytes: ArrayBuffer; contentType: string } | null>;

const DEFAULT_ATTACHMENTS_FOLDER = 'attachments';

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MD_LINK_RE = /(?<!\!)\[([^\]]*)\]\(([^)]+)\)/g;

const EXT_FROM_CONTENT_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
};

export async function processInboundAttachments(
  opts: ProcessInboundOptions
): Promise<ProcessInboundResult> {
  const refs = collectAttachmentRefs(opts.body, opts.outlineUrl);
  if (refs.length === 0) return { body: opts.body, downloaded: 0, total: 0 };

  if (!opts.fetcher) {
    // No fetcher means we can't download. Leave the body untouched — the
    // user will see Outline URLs in the file, which at least don't blow up.
    return { body: opts.body, downloaded: 0, total: refs.length };
  }
  const fetcher = opts.fetcher;
  const folderName = opts.attachmentsFolder ?? DEFAULT_ATTACHMENTS_FOLDER;
  const dir = directoryOf(opts.notePath);
  const attachDir = `${dir ? dir + '/' : ''}${folderName}`;

  let body = opts.body;
  let downloaded = 0;
  // Dedup by URL so a re-referenced attachment is downloaded once.
  const seen = new Map<string, string>(); // url → local relative path

  for (const ref of refs) {
    if (seen.has(ref.url)) {
      body = body.split(ref.url).join(seen.get(ref.url)!);
      downloaded++;
      continue;
    }
    const fetched = await fetcher(ref.url, opts.apiKey);
    if (!fetched) continue;
    const ext = pickExtension(fetched.contentType, ref.url);
    const fileName = sanitizeAttachmentName(ref, ext);
    const fullPath = `${attachDir}/${fileName}`;
    await opts.vault.writeBinary(fullPath, fetched.bytes);
    const localRef = `${folderName}/${fileName}`;
    seen.set(ref.url, localRef);
    body = body.split(ref.url).join(localRef);
    downloaded++;
  }
  return { body, downloaded, total: refs.length };
}

interface AttachmentRef {
  url: string;
  alt: string;
  /** Outline attachment UUID when extractable from the URL; used for stable filenames. */
  id?: string;
}

function collectAttachmentRefs(body: string, outlineUrl: string): AttachmentRef[] {
  const base = outlineUrl.replace(/\/$/, '');
  const matches: AttachmentRef[] = [];
  const consider = (url: string, alt: string): void => {
    if (!isOutlineAttachmentUrl(url, base)) return;
    matches.push({ url, alt, id: extractAttachmentId(url) });
  };
  for (const m of body.matchAll(MD_IMAGE_RE)) {
    consider(m[2], m[1]);
  }
  for (const m of body.matchAll(MD_LINK_RE)) {
    consider(m[2], m[1]);
  }
  return matches;
}

function isOutlineAttachmentUrl(url: string, base: string): boolean {
  if (!url.startsWith(base)) return false;
  return /\/api\/attachments\.redirect|\/api\/files\/|\/uploads\//i.test(url);
}

function extractAttachmentId(url: string): string | undefined {
  const m = /[?&]id=([0-9a-fA-F-]{8,})/.exec(url);
  if (m) return m[1];
  const m2 = /([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4,12}-[0-9a-fA-F-]{4,12})/.exec(url);
  return m2?.[1];
}

function pickExtension(contentType: string, url: string): string {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (EXT_FROM_CONTENT_TYPE[ct]) return EXT_FROM_CONTENT_TYPE[ct];
  const tail = url.split('?')[0].split('/').pop() ?? '';
  const m = /\.([a-zA-Z0-9]{1,5})$/.exec(tail);
  return m ? m[1].toLowerCase() : 'bin';
}

function sanitizeAttachmentName(ref: AttachmentRef, ext: string): string {
  const stem = ref.id ?? ref.alt ?? 'attachment';
  const safe = stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const base = safe || 'attachment';
  return base.endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

function directoryOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}
