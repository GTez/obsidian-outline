/**
 * Tiny URL-safe random ID generator. Used for SyncMapping.id.
 *
 * Avoids a dependency on the `nanoid` package — the mobile bundle stays
 * minimal, and these IDs only need to be unique within one user's
 * settings, not globally collision-resistant against an attacker.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function nanoid(size = 12): string {
  let out = '';
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const buf = new Uint8Array(size);
    c.getRandomValues(buf);
    for (let i = 0; i < size; i++) out += ALPHABET[buf[i] & 63];
    return out;
  }
  for (let i = 0; i < size; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
