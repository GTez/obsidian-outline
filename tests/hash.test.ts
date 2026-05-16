import { sha256 } from '../src/bisync/hash';

describe('sha256', () => {
  test('matches a known value for empty input', async () => {
    expect(await sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  test('matches a known value for "hello"', async () => {
    expect(await sha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  test('is stable and order-sensitive', async () => {
    const a = await sha256('ab');
    const b = await sha256('ba');
    expect(a).not.toBe(b);
    expect(await sha256('ab')).toBe(a);
  });
});
