/**
 * Plugin settings. Bidirectional sync is driven by {@link SyncMapping} entries.
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

  // ─── Bidirectional sync ──────────────────────────────────────────────────
  mappings: SyncMapping[];

  // ─── Sync behavior ───────────────────────────────────────────────────────
  syncOnStartup: boolean;
  syncOnFileOpen: boolean;
  /**
   * Sync the active mapping after the user edits a synced file. Debounced
   * by {@link syncOnSaveDebounceSeconds}. Experimental — Obsidian fires
   * modify on every auto-save, so the debounce is what makes this usable.
   */
  syncOnSave: boolean;
  /** Seconds of inactivity after a modify before triggering sync-on-save. */
  syncOnSaveDebounceSeconds: number;
  /** 0 = disabled. */
  syncIntervalMinutes: number;
  conflictBehavior: ConflictBehavior;
  /**
   * Vault-relative directory where pulled attachments are stored (single
   * centralized folder, shared across all synced notes). Default
   * `"Extras/Outline-Sync/Attachments"`. Avoid a leading underscore —
   * Remotely Save and similar plugins skip `_`-prefixed folders by default.
   */
  attachmentsPath: string;

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
  mappings: [],
  syncOnStartup: true,
  syncOnFileOpen: false,
  syncOnSave: false,
  syncOnSaveDebounceSeconds: 10,
  syncIntervalMinutes: 15,
  conflictBehavior: 'create-conflict-file',
  attachmentsPath: 'Extras/Outline-Sync/Attachments',
  rateLimitBuffer: 100,
  debugLogging: false,
  deletionsFromOutlinePropagate: false,
  deletionsFromVaultPropagate: false,
};
