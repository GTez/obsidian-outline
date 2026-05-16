import { Menu, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { OutlineClient } from '../outline-client';
import type { Collection } from '../outline-client';
import { PushEngine } from '../push-engine';
import { DEFAULT_SETTINGS, OutlineSyncSettings } from '../settings';
import { OutlineSyncSettingTab } from './setting-tab';
import { pickCollection } from './collection-picker-modal';
import { BisyncEngine } from '../bisync/engine';
import { ObsidianVaultIO } from '../bisync/obsidian-vault-io';
import { ObsidianIndexStorage } from '../bisync/index-storage';
import { obsidianAttachmentFetcher } from '../bisync/obsidian-fetcher';
import { RateLimiter } from '../outline-api/rate-limiter';
import { configure as configureOutlineApi } from '../outline-api/custom-instance';
import { getOutlineMeta } from '../pipeline';

export default class OutlineSyncPlugin extends Plugin {
  settings: OutlineSyncSettings = DEFAULT_SETTINGS;
  client!: OutlineClient;
  cachedCollections: Collection[] = [];
  engine!: BisyncEngine;
  private pushEngine!: PushEngine;
  private statusBarEl: HTMLElement | null = null;
  private intervalHandle: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.rebuildClient();

    this.addSettingTab(new OutlineSyncSettingTab(this.app, this));

    // Mobile has no status bar — `addStatusBarItem` returns null there.
    try {
      this.statusBarEl = this.addStatusBarItem();
    } catch {
      this.statusBarEl = null;
    }
    this.setStatus('idle');

    if (this.settings.outlineUrl && this.settings.apiKey) {
      void this.refreshCollections();
    }

    if (this.settings.syncOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        void this.syncAll();
      });
    }

    this.registerCommands();
    this.registerFileMenu();
    this.scheduleIntervalSync();

    if (this.settings.syncOnFileOpen) {
      this.registerEvent(
        this.app.workspace.on('file-open', (file) => {
          if (file && file.extension === 'md') {
            void this.syncFile(file);
          }
        })
      );
    }
  }

  onunload(): void {
    if (this.intervalHandle !== null) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  // ─── Commands ─────────────────────────────────────────────────────────

  private registerCommands(): void {
    this.addCommand({
      id: 'sync-all',
      name: 'Sync all mappings',
      callback: () => void this.syncAll(),
    });
    this.addCommand({
      id: 'sync-current',
      name: 'Sync current note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.syncFile(file);
        return true;
      },
    });
    this.addCommand({
      id: 'status',
      name: 'Show sync status',
      callback: () => this.showStatus(),
    });
    this.addCommand({
      id: 'force-pull',
      name: 'Force pull (overwrite local)',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.forceDirection(file, 'pull');
        return true;
      },
    });
    this.addCommand({
      id: 'force-push',
      name: 'Force push (overwrite remote)',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.forceDirection(file, 'push');
        return true;
      },
    });
    this.addCommand({
      id: 'rebuild-index',
      name: 'Rebuild local index from frontmatter',
      callback: async () => {
        await this.engine.rebuildIndex();
        new Notice('Outline Sync: index rebuilt.');
      },
    });
    this.addCommand({
      id: 'open-in-outline',
      name: 'Open current note in Outline',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.openInOutline(file);
        return true;
      },
    });

    // Upstream push commands — preserved for users who liked v1.
    this.addCommand({
      id: 'push-to-outline',
      name: 'Push active file to Outline (one-way)',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.pushFileWithPicker(file);
        return true;
      },
    });
    this.addCommand({
      id: 'push-folder-to-outline',
      name: 'Push folder to Outline (one-way)',
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const folder = file.parent;
        if (folder instanceof TFolder) {
          void this.pushFolderWithPicker(folder);
        }
      },
    });
  }

  private registerFileMenu(): void {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, abstractFile) => {
        if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
          menu.addItem((item) => {
            item
              .setTitle('Outline: sync this note')
              .setIcon('refresh-cw')
              .onClick(() => void this.syncFile(abstractFile));
          });
          menu.addItem((item) => {
            item
              .setTitle('Outline: push (one-way, legacy)')
              .setIcon('upload')
              .onClick(() => void this.pushFileWithPicker(abstractFile));
          });
        }
        if (abstractFile instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('Outline: push folder (one-way, legacy)')
              .setIcon('folder-up')
              .onClick(() => void this.pushFolderWithPicker(abstractFile));
          });
        }
      })
    );
  }

  // ─── Sync orchestration ───────────────────────────────────────────────

  async syncAll(): Promise<void> {
    if (this.settings.mappings.length === 0) {
      new Notice('Outline Sync: no mappings configured.');
      return;
    }
    this.setStatus('syncing');
    const results = await this.engine.syncAll();
    await this.saveData(this.settings); // mapping.lastFullSyncAt may have changed
    const failed = results.filter((r) => !r.ok);
    const total = results.reduce((n, r) => n + r.events.length, 0);
    if (failed.length === 0) {
      new Notice(`Outline Sync: ${results.length} mapping(s), ${total} action(s).`);
    } else {
      new Notice(`Outline Sync: ${failed.length} failed of ${results.length}.`);
    }
    this.setStatus('idle');
  }

  private async syncFile(file: TFile): Promise<void> {
    const raw = await this.app.vault.read(file);
    const meta = getOutlineMeta(raw);
    const mappingId = meta.outline_mapping_id;
    if (!mappingId) {
      new Notice('Outline Sync: this file is not part of a sync mapping.');
      return;
    }
    this.setStatus('syncing');
    const res = await this.engine.syncMappingById(mappingId);
    if (res?.ok) {
      new Notice(`Outline Sync: ${res.events.length} action(s)`);
    } else {
      new Notice(`Outline Sync: ${res?.error ?? 'no mapping found'}`);
    }
    this.setStatus('idle');
  }

  private async forceDirection(file: TFile, direction: 'pull' | 'push'): Promise<void> {
    const raw = await this.app.vault.read(file);
    const meta = getOutlineMeta(raw);
    if (!meta.outline_id) {
      new Notice('Outline Sync: this file has no outline_id.');
      return;
    }
    if (direction === 'pull') {
      const doc = await this.client.getDocument(meta.outline_id);
      if (!doc) {
        new Notice('Outline Sync: failed to fetch remote.');
        return;
      }
      await this.app.vault.modify(file, doc.text ?? '');
      new Notice('Outline Sync: force-pulled.');
    } else {
      const body = stripFrontmatter(raw);
      const doc = await this.client.updateDocument({
        id: meta.outline_id,
        title: meta.outline_title ?? file.basename,
        text: body,
        publish: true,
      });
      if (!doc) {
        new Notice('Outline Sync: force-push failed.');
        return;
      }
      new Notice('Outline Sync: force-pushed.');
    }
  }

  private async openInOutline(file: TFile): Promise<void> {
    const raw = await this.app.vault.read(file);
    const meta = getOutlineMeta(raw);
    if (!meta.outline_url) {
      new Notice('Outline Sync: no outline_url on this file.');
      return;
    }
    window.open(meta.outline_url, '_blank');
  }

  private showStatus(): void {
    const mappings = this.settings.mappings;
    if (mappings.length === 0) {
      new Notice('Outline Sync: no mappings configured.');
      return;
    }
    const lines = mappings.map(
      (m) =>
        `${m.source.displayName} → ${m.vaultPath}: ${m.enabled ? 'enabled' : 'disabled'}` +
        (m.lastFullSyncAt ? `, last ${m.lastFullSyncAt}` : ', never synced')
    );
    new Notice(`Outline Sync:\n${lines.join('\n')}`, 10_000);
  }

  // ─── Legacy push side ─────────────────────────────────────────────────

  async pushFileWithPicker(file: TFile): Promise<void> {
    const collectionId = await this.resolveCollectionId();
    if (!collectionId) return;
    void this.pushEngine.pushFile(file, collectionId);
  }

  async pushFolderWithPicker(folder: TFolder): Promise<void> {
    const collectionId = await this.resolveCollectionId();
    if (!collectionId) return;
    void this.pushEngine.pushFolder(folder, collectionId);
  }

  private async resolveCollectionId(): Promise<string | null> {
    if (this.settings.targetCollectionId) return this.settings.targetCollectionId;
    if (this.cachedCollections.length === 0) await this.refreshCollections();
    if (this.cachedCollections.length === 0) {
      new Notice('Outline Sync: No collections available. Check URL and API key.');
      return null;
    }
    return pickCollection(this.app, this.cachedCollections, '');
  }

  async refreshCollections(): Promise<void> {
    const collections = await this.client.listCollections();
    this.cachedCollections = collections ?? [];
  }

  // ─── Plumbing ─────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.rebuildClient();
    this.scheduleIntervalSync();
  }

  rebuildClient(): void {
    const limiter = new RateLimiter({ buffer: this.settings.rateLimitBuffer });
    this.client = new OutlineClient(this.settings.outlineUrl, this.settings.apiKey);
    // OutlineClient's constructor calls configure() with baseUrl/apiKey/transport;
    // we need a second pass to install the rate limiter against the same shared
    // state. configure() is idempotent for re-set fields and only updates
    // rateLimiter when explicitly passed.
    configureOutlineApi({
      baseUrl: this.settings.outlineUrl,
      apiKey: this.settings.apiKey,
      rateLimiter: limiter,
    });
    this.pushEngine = new PushEngine(this.app, this.client, this.settings);
    this.engine = new BisyncEngine({
      api: this.client,
      vault: new ObsidianVaultIO(this.app),
      indexStorage: new ObsidianIndexStorage(this),
      getSettings: () => this.settings,
      attachmentFetcher: obsidianAttachmentFetcher,
      log: (msg) => {
        if (this.settings.debugLogging) console.log('[outline-sync]', msg);
      },
    });
  }

  // ─── Status bar + interval ────────────────────────────────────────────

  private setStatus(state: 'idle' | 'syncing'): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.setText(state === 'syncing' ? '◌ Outline sync…' : '✓ Outline');
  }

  private scheduleIntervalSync(): void {
    if (this.intervalHandle !== null) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    const minutes = this.settings.syncIntervalMinutes;
    if (!minutes || minutes <= 0) return;
    this.intervalHandle = window.setInterval(
      () => void this.syncAll(),
      minutes * 60 * 1000
    );
    this.registerInterval(this.intervalHandle);
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}
