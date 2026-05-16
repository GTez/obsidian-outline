import { App, DropdownComponent, Notice, PluginSettingTab, Setting } from 'obsidian';
import type OutlineSyncPlugin from './main';
import type { Collection } from '../outline-client';
import type { ConflictBehavior, SyncMapping } from '../settings';
import { MappingModal } from './mapping-modal';

export class OutlineSyncSettingTab extends PluginSettingTab {
  plugin: OutlineSyncPlugin;
  private collectionDropdown: DropdownComponent | null = null;

  constructor(app: App, plugin: OutlineSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderSecurityWarning(containerEl);
    this.renderConnectionSection(containerEl);
    this.renderMappingsSection(containerEl);
    this.renderLegacyPushSection(containerEl);
    this.renderSyncBehaviorSection(containerEl);
    this.renderAdvancedSection(containerEl);
  }

  // ─── Sections ──────────────────────────────────────────────────────────

  private renderSecurityWarning(parent: HTMLElement): void {
    const warning = parent.createEl('div', { cls: 'callout' });
    warning.style.cssText =
      'background:var(--background-modifier-error-hover);border-left:3px solid var(--color-orange);padding:8px 12px;margin-bottom:16px;border-radius:4px;font-size:0.85em;';
    warning.createEl('strong', { text: 'Security notice: ' });
    warning.appendText(
      'The API key is stored in plain text in data.json. Exclude it from cloud sync (Obsidian Sync, iCloud, Dropbox).'
    );
  }

  private renderConnectionSection(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Connection' });

    new Setting(parent)
      .setName('Outline URL')
      .setDesc('URL of your Outline instance, e.g. https://outline.example.com')
      .addText((text) =>
        text
          .setPlaceholder('https://outline.example.com')
          .setValue(this.plugin.settings.outlineUrl)
          .onChange(async (value) => {
            this.plugin.settings.outlineUrl = value.trim().replace(/\/$/, '');
            await this.plugin.saveSettings();
          })
      );

    new Setting(parent)
      .setName('API Key')
      .setDesc('Outline API Key (Settings → API & Apps)')
      .addText((text) => {
        text
          .setPlaceholder('ol_api_...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    new Setting(parent)
      .setName('Test connection')
      .setDesc('Verify the URL and API key.')
      .addButton((btn) =>
        btn
          .setButtonText('Connect')
          .setCta()
          .onClick(async () => {
            btn.setButtonText('Checking…');
            btn.setDisabled(true);
            const name = await this.plugin.client.validateAuth();
            btn.setDisabled(false);
            if (name) {
              btn.setButtonText(`✓ ${name}`);
              await this.plugin.refreshCollections();
            } else {
              btn.setButtonText('✗ Failed');
              new Notice('Connection failed. Check URL and API key.');
            }
          })
      );
  }

  private renderMappingsSection(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Sync mappings' });
    parent.createEl('p', {
      text: 'Each mapping syncs an Outline document or collection subtree to a vault folder.',
      cls: 'setting-item-description',
    });

    const list = parent.createEl('div');
    const mappings = this.plugin.settings.mappings;
    if (mappings.length === 0) {
      list.createEl('p', { text: 'No mappings yet.', cls: 'setting-item-description' });
    }
    for (const mapping of mappings) {
      this.renderMappingRow(list, mapping);
    }

    new Setting(parent).addButton((b) =>
      b
        .setButtonText('+ Add mapping')
        .setCta()
        .onClick(() => {
          new MappingModal(this.app, this.plugin.engine, null, async (m) => {
            this.plugin.settings.mappings.push(m);
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
    );
  }

  private renderMappingRow(parent: HTMLElement, mapping: SyncMapping): void {
    const setting = new Setting(parent)
      .setName(`${mapping.source.displayName} (${mapping.source.type})`)
      .setDesc(
        `→ ${mapping.vaultPath || '(unset)'}${mapping.includeRoot ? '' : ' [children only]'}` +
          (mapping.lastFullSyncAt ? `  · last sync: ${mapping.lastFullSyncAt}` : '')
      );
    setting.addToggle((t) =>
      t.setValue(mapping.enabled).onChange(async (v) => {
        mapping.enabled = v;
        await this.plugin.saveSettings();
      })
    );
    setting.addButton((b) =>
      b.setIcon('refresh-cw').setTooltip('Sync now').onClick(async () => {
        new Notice(`Syncing ${mapping.source.displayName}…`);
        const res = await this.plugin.engine.syncMappingById(mapping.id);
        if (res?.ok) {
          new Notice(`✓ ${mapping.source.displayName}: ${res.events.length} action(s)`);
        } else {
          new Notice(`✗ ${mapping.source.displayName}: ${res?.error ?? 'unknown error'}`);
        }
        this.display();
      })
    );
    setting.addButton((b) =>
      b.setIcon('pencil').setTooltip('Edit').onClick(() => {
        new MappingModal(this.app, this.plugin.engine, mapping, async (updated) => {
          const idx = this.plugin.settings.mappings.findIndex((m) => m.id === mapping.id);
          if (idx >= 0) this.plugin.settings.mappings[idx] = updated;
          await this.plugin.saveSettings();
          this.display();
        }).open();
      })
    );
    setting.addButton((b) =>
      b.setIcon('trash-2').setTooltip('Delete mapping').onClick(async () => {
        this.plugin.settings.mappings = this.plugin.settings.mappings.filter(
          (m) => m.id !== mapping.id
        );
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }

  private renderLegacyPushSection(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Manual push (legacy)' });
    parent.createEl('p', {
      cls: 'setting-item-description',
      text:
        'The original one-way push commands still work. Pick a default collection for "Push to Outline".',
    });

    new Setting(parent)
      .setName('Default collection')
      .addDropdown((dropdown) => {
        this.collectionDropdown = dropdown;
        dropdown.addOption('', '— Test connection first —');
        if (this.plugin.settings.targetCollectionId) {
          dropdown.addOption(
            this.plugin.settings.targetCollectionId,
            this.plugin.settings.targetCollectionName
          );
          dropdown.setValue(this.plugin.settings.targetCollectionId);
        }
        const collections = this.plugin.cachedCollections;
        if (collections.length > 0) {
          dropdown.selectEl.empty();
          dropdown.addOption('', '— Select collection —');
          for (const c of collections) {
            dropdown.addOption(c.id ?? '', c.name ?? '');
          }
          if (this.plugin.settings.targetCollectionId) {
            dropdown.setValue(this.plugin.settings.targetCollectionId);
          }
        }
        dropdown.onChange(async (value) => {
          const found = collections.find((c: Collection) => c.id === value);
          this.plugin.settings.targetCollectionId = value;
          this.plugin.settings.targetCollectionName = found?.name ?? '';
          await this.plugin.saveSettings();
        });
      });

    new Setting(parent)
      .setName('Remove table of contents on push')
      .setDesc('Strip TOC blocks before pushing to Outline.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.removeToc).onChange(async (value) => {
          this.plugin.settings.removeToc = value;
          await this.plugin.saveSettings();
        })
      );
  }

  private renderSyncBehaviorSection(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Sync behavior' });

    new Setting(parent)
      .setName('Sync on startup')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.syncOnStartup).onChange(async (v) => {
          this.plugin.settings.syncOnStartup = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(parent)
      .setName('Sync on file open')
      .setDesc('Re-sync the active mapping when its file is opened. Can be noisy.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.syncOnFileOpen).onChange(async (v) => {
          this.plugin.settings.syncOnFileOpen = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(parent)
      .setName('Sync interval (minutes)')
      .setDesc('0 = disabled. Outline VPN can drop, so silent failures are OK.')
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n >= 0) {
              this.plugin.settings.syncIntervalMinutes = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(parent)
      .setName('Conflict behavior')
      .addDropdown((d) => {
        const opts: Record<ConflictBehavior, string> = {
          'create-conflict-file': 'Create conflict file (safe, default)',
          'prefer-local': 'Prefer local',
          'prefer-remote': 'Prefer remote',
        };
        for (const [k, label] of Object.entries(opts)) {
          d.addOption(k, label);
        }
        d.setValue(this.plugin.settings.conflictBehavior).onChange(async (v) => {
          this.plugin.settings.conflictBehavior = v as ConflictBehavior;
          await this.plugin.saveSettings();
        });
      });
  }

  private renderAdvancedSection(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Advanced' });

    new Setting(parent)
      .setName('Rate limit buffer (requests/hour)')
      .setDesc('Headroom kept under Outline\'s 1000/hr ceiling.')
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.rateLimitBuffer))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n >= 0) {
              this.plugin.settings.rateLimitBuffer = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(parent)
      .setName('Debug logging')
      .setDesc('Logs every sync decision to the developer console.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.debugLogging).onChange(async (v) => {
          this.plugin.settings.debugLogging = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(parent)
      .setName('Propagate vault deletions to Outline')
      .setDesc('Off by default. Deleted local files do NOT delete the Outline doc.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.deletionsFromVaultPropagate).onChange(async (v) => {
          this.plugin.settings.deletionsFromVaultPropagate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(parent)
      .setName('Propagate Outline deletions to vault')
      .setDesc('Off by default. Outline-deleted docs become orphans locally.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.deletionsFromOutlinePropagate).onChange(async (v) => {
          this.plugin.settings.deletionsFromOutlinePropagate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(parent)
      .setName('Rebuild local index')
      .setDesc('Re-derives the sync index from frontmatter. Safe to run any time.')
      .addButton((b) =>
        b.setButtonText('Rebuild').onClick(async () => {
          await this.plugin.engine.rebuildIndex();
          new Notice('Outline Sync: index rebuilt.');
        })
      );
  }
}
