import type { TransformerPlugin, TransformContext } from '../types';

export type OutlineSyncStatus = 'synced' | 'orphaned' | 'conflict';

export interface OutlineFrontmatter {
  outline_id?: string;
  outline_collection_id?: string;
  outline_last_synced?: string;

  // v2 — bidirectional sync metadata. Optional so v1 docs remain valid.
  /** Outline's revision counter at the last successful sync. */
  outline_revision?: number;
  /** SHA-256 of the body Outline returned at the last sync (not what we sent). */
  outline_synced_hash?: string;
  /** Outline UUID of the parent document; null for mapping roots. */
  outline_parent_id?: string | null;
  /** Convenience link back to the doc in Outline. */
  outline_url?: string;
  /** Lifecycle marker. */
  outline_sync_status?: OutlineSyncStatus;
  /** Which mapping (by SyncMapping.id) this note belongs to. */
  outline_mapping_id?: string;
  /** Outline's title at the last sync; used to detect server-side renames. */
  outline_title?: string;
  /**
   * Only set on `.outline-conflict-*.md` files. Points back at the local
   * file the conflict was generated for. Files with this set are excluded
   * from sync (they are leaves of the resolution workflow, not docs).
   */
  conflict_for?: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) {
    return { meta: {}, body: content };
  }

  const meta: Record<string, unknown> = {};
  const raw = match[1];

  for (const line of raw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    if (value === 'true') meta[key] = true;
    else if (value === 'false') meta[key] = false;
    else if (value !== '' && !isNaN(Number(value))) meta[key] = Number(value);
    else meta[key] = value.replace(/^["']|["']$/g, '');
  }

  const body = content.slice(match[0].length);
  return { meta, body };
}

export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_REGEX, '');
}

export function getOutlineMeta(content: string): OutlineFrontmatter {
  const { meta } = parseFrontmatter(content);
  const parent = meta['outline_parent_id'];
  const status = meta['outline_sync_status'];
  return {
    outline_id: meta['outline_id'] as string | undefined,
    outline_collection_id: meta['outline_collection_id'] as string | undefined,
    outline_last_synced: meta['outline_last_synced'] as string | undefined,
    outline_revision:
      typeof meta['outline_revision'] === 'number'
        ? (meta['outline_revision'] as number)
        : undefined,
    outline_synced_hash: meta['outline_synced_hash'] as string | undefined,
    outline_parent_id:
      parent === 'null' || parent === '' || parent === undefined
        ? undefined
        : (parent as string),
    outline_url: meta['outline_url'] as string | undefined,
    outline_sync_status:
      status === 'synced' || status === 'orphaned' || status === 'conflict'
        ? status
        : undefined,
    outline_mapping_id: meta['outline_mapping_id'] as string | undefined,
    outline_title: meta['outline_title'] as string | undefined,
    conflict_for: meta['conflict_for'] as string | undefined,
  };
}

export const FrontmatterTransformer: TransformerPlugin = () => ({
  name: 'FrontmatterTransformer',
  transform(ctx: TransformContext): TransformContext {
    const { meta, body } = parseFrontmatter(ctx.content);
    return {
      ...ctx,
      content: body,
      meta: {
        ...ctx.meta,
        frontmatter: meta,
        plugins: {
          ...ctx.meta.plugins,
          FrontmatterTransformer: { hadFrontmatter: body !== ctx.content },
        },
      },
    };
  },
});
