/**
 * Plugin settings.
 *
 * The original (v1) settings drove a one-way push from Obsidian → Outline. v2
 * adds bidirectional sync via {@link SyncMapping} entries. We keep the legacy
 * fields (`targetCollectionId`, `targetCollectionName`, `removeToc`) so older
 * configurations and the existing push commands keep working during the
 * transition.
 */

export type ConflictBehavior = 'create-conflict-file' | 'prefer-local' | 'prefer-remote';

export interface SyncMappingSource {
  type: 'document' | 'collection';
  /** Outline UUID. Resolved once from whatever the user typed. */
  outlineId: string;
  /** Cached for the settings UI so we don't re-fetch on every render. */
  displayName: string;
  /** ISO timestamp of the last successful resolution. */
  lastResolvedAt: string;
}

export interface SyncMapping {
  /** Stable internal id (nanoid-like). Used to tag notes via outline_mapping_id. */
  id: string;
  source: SyncMappingSource;
  /** Forward-slashed, no leading slash, relative to the vault root. */
  vaultPath: string;
  /** When source is a document, also sync the document itself (vs. just its children). */
  includeRoot: boolean;
  enabled: boolean;
  /** ISO timestamp; null until the first full sync completes. */
  lastFullSyncAt: string | null;
}

export interface OutlineSyncSettings {
  // ─── Connection ──────────────────────────────────────────────────────────
  outlineUrl: string;
  apiKey: string;

  // ─── Legacy push-only settings (kept so v1 users don't lose state) ───────
  /** @deprecated Use mappings instead. Retained to keep the push commands working. */
  targetCollectionId: string;
  /** @deprecated */
  targetCollectionName: string;
  /** Applied to push side; pull side leaves Outline's markdown alone. */
  removeToc: boolean;

  // ─── Bidirectional sync ──────────────────────────────────────────────────
  mappings: SyncMapping[];

  // ─── Sync behavior ───────────────────────────────────────────────────────
  syncOnStartup: boolean;
  syncOnFileOpen: boolean;
  /** 0 = disabled. */
  syncIntervalMinutes: number;
  conflictBehavior: ConflictBehavior;
  /**
   * Where pulled attachments are stored, relative to each note's folder.
   * Default `"attachments"`. Avoid a leading underscore — Remotely Save
   * and similar plugins skip `_`-prefixed folders by default.
   */
  attachmentFolderName: string;

  // ─── Advanced ────────────────────────────────────────────────────────────
  /** Requests/hour to leave unused as a safety margin against the ~1000/hr limit. */
  rateLimitBuffer: number;
  debugLogging: boolean;
  deletionsFromOutlinePropagate: boolean;
  deletionsFromVaultPropagate: boolean;
}

export const DEFAULT_SETTINGS: OutlineSyncSettings = {
  outlineUrl: '',
  apiKey: '',
  targetCollectionId: '',
  targetCollectionName: '',
  removeToc: false,
  mappings: [],
  syncOnStartup: true,
  syncOnFileOpen: false,
  syncIntervalMinutes: 15,
  conflictBehavior: 'create-conflict-file',
  attachmentFolderName: 'attachments',
  rateLimitBuffer: 100,
  debugLogging: false,
  deletionsFromOutlinePropagate: false,
  deletionsFromVaultPropagate: false,
};
