/**
 * SHA-256 of a UTF-8 string.
 *
 * Uses Web Crypto (available on Obsidian desktop and mobile, plus modern
 * Node via `globalThis.crypto`). No external dependencies — keeping the
 * mobile bundle small is an explicit design goal.
 */

interface SubtleLike {
  digest(algo: string, data: BufferSource): Promise<ArrayBuffer>;
}

function getSubtle(): SubtleLike {
  const c = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto;
  if (c?.subtle) return c.subtle;
  throw new Error('Web Crypto Subtle is unavailable in this environment');
}

export async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await getSubtle().digest('SHA-256', bytes);
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
