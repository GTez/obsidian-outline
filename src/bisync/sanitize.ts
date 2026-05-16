/**
 * Filename sanitization for Outline titles → vault paths.
 *
 * Outline titles can contain characters that are illegal on Windows and/or
 * macOS/Linux (`/ \ : * ? " < > |`), and Windows additionally hates trailing
 * dots and trailing whitespace. We normalize to a safe form while
 * preserving Unicode.
 */

const ILLEGAL_CHARS_RE = /[/\\:*?"<>|]/g;
const TRAILING_CRUFT_RE = /[\s.]+$/;

export function sanitizeBasename(title: string): string {
  let out = title.replace(ILLEGAL_CHARS_RE, '-');
  // Collapse runs of whitespace to a single space, but keep the rest.
  out = out.replace(/\s+/g, ' ');
  out = out.replace(TRAILING_CRUFT_RE, '');
  out = out.trim();
  // A string that's nothing but the placeholder we inserted (e.g. user title
  // was just "/////") is not useful as a filename.
  if (/^-+$/.test(out)) out = '';
  if (!out) out = 'Untitled';
  return out;
}

/**
 * Resolve a basename against a set of sibling names, appending `(1)`,
 * `(2)`, ... until unique. Comparison is case-sensitive — vaults on
 * case-insensitive filesystems may still collide, but that's true of any
 * sibling write and Obsidian surfaces it; we don't second-guess.
 */
export function ensureUniqueBasename(desired: string, siblings: Set<string>): string {
  if (!siblings.has(desired)) return desired;
  let n = 1;
  while (n < 1000) {
    const candidate = `${desired} (${n})`;
    if (!siblings.has(candidate)) return candidate;
    n++;
  }
  // Unreachable in practice — but better than infinite-looping.
  return `${desired} (${Date.now()})`;
}
