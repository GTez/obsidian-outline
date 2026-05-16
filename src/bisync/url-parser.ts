/**
 * Parse the many forms in which a user might point at an Outline document
 * or collection.
 *
 * Accepts:
 *  - Full URL: https://outline.example.com/doc/slug-AbCdEf12Gh
 *  - Full URL (collection): https://outline.example.com/collection/slug-AbCdEf12Gh
 *  - UUID: 7c2f4a91-8b3d-4e1f-9a2c-1d4e7f8a9b0c
 *  - Short ID: AbCdEf12Gh
 *  - Slug + short ID: my-document-AbCdEf12Gh
 *
 * Returns the identifier to send to Outline (Outline's documents.info /
 * collections.info accept either the UUID or the short ID) plus the source
 * type when it can be inferred from a URL.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHORT_ID_RE = /^[A-Za-z0-9]{8,32}$/;

export type SourceTypeHint = 'document' | 'collection' | 'unknown';

export interface ParsedSourceRef {
  /** UUID or short ID to send to Outline. */
  identifier: string;
  /** When parseable from a URL path, the inferred source type. */
  typeHint: SourceTypeHint;
}

export function parseSourceRef(input: string): ParsedSourceRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // URL form.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const segments = url.pathname.split('/').filter(Boolean);
      // Expect .../<doc|collection>/<slug-or-id>
      const kindIdx = segments.findIndex((s) => s === 'doc' || s === 'collection');
      if (kindIdx === -1 || !segments[kindIdx + 1]) return null;
      const kind = segments[kindIdx];
      const tail = segments[kindIdx + 1];
      const id = extractIdFromTail(tail);
      if (!id) return null;
      return {
        identifier: id,
        typeHint: kind === 'doc' ? 'document' : 'collection',
      };
    } catch {
      return null;
    }
  }

  // UUID — let Outline figure out whether it's a doc or collection.
  if (UUID_RE.test(trimmed)) {
    return { identifier: trimmed, typeHint: 'unknown' };
  }

  // Bare short ID.
  if (SHORT_ID_RE.test(trimmed)) {
    return { identifier: trimmed, typeHint: 'unknown' };
  }

  // Slug-with-shortid: take the last hyphen-separated token if it parses.
  const last = trimmed.split('-').pop() ?? '';
  if (SHORT_ID_RE.test(last)) {
    return { identifier: last, typeHint: 'unknown' };
  }
  return null;
}

function extractIdFromTail(tail: string): string | null {
  // URL paths can be raw UUIDs, bare short IDs, or slug-shortid.
  if (UUID_RE.test(tail)) return tail;
  if (SHORT_ID_RE.test(tail)) return tail;
  const last = tail.split('-').pop() ?? '';
  if (SHORT_ID_RE.test(last)) return last;
  return null;
}
