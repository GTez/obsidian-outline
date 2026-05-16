import { App, Modal, Notice, Setting } from 'obsidian';
import type { BisyncEngine } from '../bisync/engine';
import type { SyncMapping } from '../settings';

/**
 * Modal for adding or editing a SyncMapping.
 *
 * Resolves whatever the user types in the "Source" field against Outline
 * before saving — both as a sanity check and so the displayName + UUID
 * get cached in settings.
 */
export class MappingModal extends Modal {
  private inputSource: string;
  private inputVaultPath: string;
  private inputIncludeRoot: boolean;
  private resolveResult:
    | { type: 'document' | 'collection'; outlineId: string; displayName: string }
    | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly engine: BisyncEngine,
    private readonly existing: SyncMapping | null,
    private readonly onSave: (mapping: SyncMapping) => void
  ) {
    super(app);
    if (existing) {
      this.inputSource = existing.source.outlineId;
      this.inputVaultPath = existing.vaultPath;
      this.inputIncludeRoot = existing.includeRoot;
      this.resolveResult = {
        type: existing.source.type,
        outlineId: existing.source.outlineId,
        displayName: existing.source.displayName,
      };
    } else {
      this.inputSource = '';
      this.inputVaultPath = '';
      this.inputIncludeRoot = true;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.existing ? 'Edit mapping' : 'Add mapping' });

    new Setting(contentEl)
      .setName('Outline source')
      .setDesc('URL, UUID, or short ID of an Outline document or collection.')
      .addText((t) =>
        t
          .setPlaceholder('https://outline.example.com/doc/my-doc-AbCdEf12Gh')
          .setValue(this.inputSource)
          .onChange((v) => {
            this.inputSource = v.trim();
            this.resolveResult = null;
            if (this.statusEl) this.statusEl.setText('');
          })
      );

    const statusSetting = new Setting(contentEl)
      .setName('Resolved')
      .setDesc('Click "Resolve" to verify and load the source name.');
    this.statusEl = statusSetting.descEl;
    statusSetting.addButton((b) =>
      b
        .setButtonText('Resolve')
        .setCta()
        .onClick(async () => {
          if (this.statusEl) this.statusEl.setText('Resolving…');
          const res = await this.engine.resolveSource(this.inputSource);
          if (!res) {
            this.resolveResult = null;
            if (this.statusEl) this.statusEl.setText('✗ Could not resolve');
            return;
          }
          this.resolveResult = res;
          if (this.statusEl)
            this.statusEl.setText(`✓ ${res.type === 'document' ? 'Doc' : 'Collection'}: ${res.displayName}`);
        })
    );

    new Setting(contentEl)
      .setName('Vault folder')
      .setDesc('Where in the vault this subtree should live. Example: Work/Outline')
      .addText((t) =>
        t
          .setPlaceholder('Work/Outline')
          .setValue(this.inputVaultPath)
          .onChange((v) => {
            this.inputVaultPath = v.trim().replace(/^\/+|\/+$/g, '');
          })
      );

    new Setting(contentEl)
      .setName('Include root document')
      .setDesc('When the source is a document, sync it itself as well as its children.')
      .addToggle((t) =>
        t.setValue(this.inputIncludeRoot).onChange((v) => {
          this.inputIncludeRoot = v;
        })
      );

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Save')
          .setCta()
          .onClick(() => this.save())
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  private save(): void {
    if (!this.resolveResult) {
      new Notice('Resolve the source first — we need to verify it exists in Outline.');
      return;
    }
    if (!this.inputVaultPath) {
      new Notice('Vault folder is required.');
      return;
    }
    const built = this.engine.buildMapping({
      type: this.resolveResult.type,
      outlineId: this.resolveResult.outlineId,
      displayName: this.resolveResult.displayName,
      vaultPath: this.inputVaultPath,
      includeRoot: this.inputIncludeRoot,
    });
    const mapping: SyncMapping = this.existing
      ? { ...this.existing, source: built.source, vaultPath: built.vaultPath, includeRoot: built.includeRoot }
      : built;
    this.onSave(mapping);
    this.close();
  }
}
