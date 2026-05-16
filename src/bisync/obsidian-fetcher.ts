/**
 * Obsidian-flavored attachment fetcher.
 *
 * Lives in its own file so the rest of `src/bisync/` stays free of the
 * `obsidian` module — that keeps engine logic node-testable.
 */

import { requestUrl } from 'obsidian';
import type { AttachmentFetcher } from './attachments';

export const obsidianAttachmentFetcher: AttachmentFetcher = async (url, apiKey) => {
  try {
    const res = await requestUrl({
      url,
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      throw: false,
    });
    if (res.status >= 400) return null;
    const headers = res.headers ?? {};
    const ct =
      headers['content-type'] ??
      headers['Content-Type'] ??
      'application/octet-stream';
    return { bytes: res.arrayBuffer, contentType: ct };
  } catch {
    return null;
  }
};
