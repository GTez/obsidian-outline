import { parseSourceRef } from '../src/bisync/url-parser';

describe('parseSourceRef', () => {
  test('parses a doc URL with slug-shortid tail', () => {
    const out = parseSourceRef('https://outline.example.com/doc/my-document-AbCdEf12Gh');
    expect(out).toEqual({ identifier: 'AbCdEf12Gh', typeHint: 'document' });
  });

  test('parses a collection URL', () => {
    const out = parseSourceRef('https://outline.example.com/collection/eng-AbCdEf12Gh');
    expect(out).toEqual({ identifier: 'AbCdEf12Gh', typeHint: 'collection' });
  });

  test('parses a doc URL with bare short ID', () => {
    const out = parseSourceRef('https://outline.example.com/doc/AbCdEf12Gh');
    expect(out).toEqual({ identifier: 'AbCdEf12Gh', typeHint: 'document' });
  });

  test('parses a bare UUID', () => {
    const id = '7c2f4a91-8b3d-4e1f-9a2c-1d4e7f8a9b0c';
    expect(parseSourceRef(id)).toEqual({ identifier: id, typeHint: 'unknown' });
  });

  test('parses a bare short ID', () => {
    expect(parseSourceRef('AbCdEf12Gh')).toEqual({
      identifier: 'AbCdEf12Gh',
      typeHint: 'unknown',
    });
  });

  test('parses slug-shortid (no URL)', () => {
    expect(parseSourceRef('my-doc-AbCdEf12Gh')).toEqual({
      identifier: 'AbCdEf12Gh',
      typeHint: 'unknown',
    });
  });

  test('returns null on garbage', () => {
    expect(parseSourceRef('')).toBeNull();
    expect(parseSourceRef('not a url or id')).toBeNull();
    expect(parseSourceRef('https://outline.example.com/settings')).toBeNull();
  });

  test('parses a URL with a path prefix', () => {
    const out = parseSourceRef('https://outline.example.com/team/doc/my-doc-AbCdEf12Gh');
    expect(out).toEqual({ identifier: 'AbCdEf12Gh', typeHint: 'document' });
  });
});
