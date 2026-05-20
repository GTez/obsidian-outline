/**
 * Collapse runs of 3+ newlines to exactly two (one blank line between
 * blocks), preserving content inside fenced code blocks verbatim. A line
 * containing nothing but a backslash is treated as blank — Outline's
 * ProseMirror-based serializer emits empty paragraphs that way, and they
 * otherwise render in Obsidian as a literal `\`.
 *
 * Lines that *end* with a backslash but have other content (`foo\`) are a
 * markdown hard line break and are left alone.
 *
 * Safe with invariant 1 (hashes are over disk content): normalization runs
 * before the synced-hash is computed, so re-reads produce the same hash.
 */
export function normalizeBlankLines(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let blankRun = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      out.push(line);
      blankRun = 0;
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    if (trimmed === '' || trimmed === '\\') {
      blankRun++;
      if (blankRun <= 1) out.push('');
    } else {
      blankRun = 0;
      out.push(line);
    }
  }

  return out.join('\n');
}
