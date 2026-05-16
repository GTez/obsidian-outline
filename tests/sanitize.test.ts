import { ensureUniqueBasename, sanitizeBasename } from '../src/bisync/sanitize';

describe('sanitizeBasename', () => {
  test('replaces illegal characters with hyphens', () => {
    expect(sanitizeBasename('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });
  test('preserves Unicode', () => {
    expect(sanitizeBasename('日本語タイトル')).toBe('日本語タイトル');
  });
  test('trims trailing dots and spaces (Windows-hostile)', () => {
    expect(sanitizeBasename('Hello.   ')).toBe('Hello');
    expect(sanitizeBasename('Hello.')).toBe('Hello');
  });
  test('replaces empty result with Untitled', () => {
    expect(sanitizeBasename('   ')).toBe('Untitled');
    expect(sanitizeBasename('////')).toBe('Untitled');
  });
  test('collapses internal whitespace', () => {
    expect(sanitizeBasename('Hello   world')).toBe('Hello world');
  });
});

describe('ensureUniqueBasename', () => {
  test('returns the input if not colliding', () => {
    expect(ensureUniqueBasename('Hello', new Set(['Other']))).toBe('Hello');
  });
  test('appends (1), (2) on collision', () => {
    const siblings = new Set(['Hello', 'Hello (1)']);
    expect(ensureUniqueBasename('Hello', siblings)).toBe('Hello (2)');
  });
});
