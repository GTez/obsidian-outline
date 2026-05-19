import { normalizeBlankLines } from '../src/bisync/markdown-normalize';

describe('normalizeBlankLines', () => {
  test('collapses three newlines to two between paragraphs', () => {
    expect(normalizeBlankLines('first\n\n\nsecond')).toBe('first\n\nsecond');
  });

  test('collapses four-plus newlines to two', () => {
    expect(normalizeBlankLines('first\n\n\n\n\nsecond')).toBe('first\n\nsecond');
  });

  test('leaves a single blank line untouched', () => {
    expect(normalizeBlankLines('first\n\nsecond')).toBe('first\n\nsecond');
  });

  test('leaves no blank line untouched', () => {
    expect(normalizeBlankLines('first\nsecond')).toBe('first\nsecond');
  });

  test('preserves blank lines inside fenced code blocks', () => {
    const input = ['```js', 'a', '', '', '', 'b', '```'].join('\n');
    expect(normalizeBlankLines(input)).toBe(input);
  });

  test('still normalizes around fenced blocks', () => {
    const input = ['p1', '', '', '```js', 'code', '```', '', '', '', 'p2'].join('\n');
    const expected = ['p1', '', '```js', 'code', '```', '', 'p2'].join('\n');
    expect(normalizeBlankLines(input)).toBe(expected);
  });

  test('handles tilde-fenced code blocks', () => {
    const input = ['~~~', 'a', '', '', 'b', '~~~'].join('\n');
    expect(normalizeBlankLines(input)).toBe(input);
  });

  test('does not confuse ``` and ~~~ fence types', () => {
    // A tilde fence inside a backtick fence shouldn't close it.
    const input = ['```', 'a', '', '', '~~~', 'b', '```'].join('\n');
    expect(normalizeBlankLines(input)).toBe(input);
  });

  test('treats whitespace-only lines as blank', () => {
    expect(normalizeBlankLines('first\n   \n\t\n  \nsecond')).toBe('first\n\nsecond');
  });

  test('idempotent', () => {
    const input = 'one\n\n\n\ntwo\n\n\nthree';
    const once = normalizeBlankLines(input);
    expect(normalizeBlankLines(once)).toBe(once);
  });

  test('empty string round-trips', () => {
    expect(normalizeBlankLines('')).toBe('');
  });
});
