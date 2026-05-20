# Outline Sync — Obsidian Plugin

Bidirectional sync between [Obsidian](https://obsidian.md) and a self-hosted or cloud [Outline](https://www.getoutline.com/) knowledge base.

Map an Outline document or collection subtree to a vault folder. Edits flow in both directions. Conflicts surface as side-by-side files, not silent overwrites. Works on desktop **and** mobile.

> v2.3.0 removes the legacy v1 one-way push commands. If you still need them, pin to ≤ 2.2.x.

## Features

- **True two-way sync.** Hash-based change detection plus Outline's revision counter decide pull / push / no-op / conflict per document.
- **Folder-note hierarchy.** Outline documents with children become folders containing a same-named markdown file, matching the [Folder Notes](https://github.com/LostPaul/obsidian-folder-notes) convention. Pure leaves stay as plain files.
- **Conflict-safe.** When both sides change between syncs, the remote version is written next to the local file as `<note>.outline-conflict-<timestamp>.md`. Your file is marked `outline_sync_status: conflict` and skipped until the conflict file is deleted.
- **Attachment round-trip.** Images you embed locally get uploaded to Outline; images on the Outline side get downloaded into the vault and rewritten to local paths. Uploads are deduplicated by content hash — the same image won't be re-uploaded on every push.
- **Title and move detection.** Renaming a doc in Outline renames the file (and folder, for folder-notes) locally, preserving backlinks. Docs moved out of a mapped subtree become orphans, not deletions.
- **Rate-limited.** Rolling 1h request counter with a configurable buffer keeps you safely under Outline's default 1000 req/hr ceiling.
- **Mobile compatible.** All HTTP routes through Obsidian's `requestUrl`; no Node-only APIs.

## Requirements

- Obsidian 1.0 or later (desktop or mobile)
- An Outline instance (self-hosted or [app.getoutline.com](https://app.getoutline.com))
- An Outline API key (Outline → **Settings → API & Apps**)

## Installation

### BRAT (recommended — works on desktop, iOS, and iPadOS)

The plugin isn't in Obsidian's community store yet, so the cleanest way to install it across multiple devices — especially iOS and iPadOS, where you can't drop files into the vault's plugins folder by hand — is via **BRAT** (Beta Reviewer's Auto-update Tester).

On each device:

1. Install **BRAT** from **Settings → Community Plugins → Browse** and enable it.
2. Run the command **BRAT: Add a beta plugin for testing**.
3. Paste the repo URL: `https://github.com/GTez/obsidian-outline`.
4. BRAT downloads `main.js` and `manifest.json` from the latest GitHub release and installs them into `<vault>/.obsidian/plugins/obsidian-outline-sync/`.
5. Enable **Outline Sync** in **Settings → Community Plugins**.

BRAT will auto-update the plugin whenever a new release is published (or you can trigger **BRAT: Check for updates to all beta plugins** manually).

### Manual (desktop only)

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/GTez/obsidian-outline/releases).
2. Copy both files to `<vault>/.obsidian/plugins/obsidian-outline-sync/`.
3. Enable the plugin in **Settings → Community Plugins**.

### From source

```bash
git clone https://github.com/GTez/obsidian-outline
cd obsidian-outline
npm install
npm run build
# Copy main.js and manifest.json into your vault's plugins folder.
```

## Setup

1. Open **Settings → Outline Sync**.
2. **Connection.** Paste your Outline URL and API key. Click **Connect** to verify; the plugin will load your collections.
3. **Sync mappings.** Click **+ Add mapping** and provide:
   - **Outline source.** Paste any of: a full URL (`https://outline.example.com/doc/slug-AbCdEf12Gh`), a UUID, a short ID, or a slug-shortid. Click **Resolve** to verify and preview the source name.
   - **Vault folder.** Where the subtree should live (e.g. `Work/Outline`). Created if missing.
   - **Include root document.** For document-rooted mappings, decide whether to sync the source doc itself or just its children.
4. **Sync behavior.** Pick whether to sync on startup, on file open, or on a timed interval. Pick a conflict policy (the default writes a conflict file and is recommended).
5. **Advanced.** Adjust the rate-limit buffer, enable debug logging, choose the attachment folder name.

Click **Sync all mappings** from the Command Palette, or use the per-mapping **Sync now** button in settings.

## Commands

| Command                                | What it does                                                              |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `Outline Sync: Sync all mappings`      | Run every enabled mapping serially.                                       |
| `Outline Sync: Sync current note`      | Sync the mapping the active file belongs to.                              |
| `Outline Sync: Show sync status`       | Notice with each mapping's last-sync time.                                |
| `Outline Sync: Force pull`             | Overwrite the active file with the remote body. Bypasses change detection. |
| `Outline Sync: Force push`             | Overwrite the remote with the local body. Bypasses change detection.      |
| `Outline Sync: Rebuild local index`    | Re-derive the sync index from frontmatter.                                |
| `Outline Sync: Open in Outline`        | Open the active file's Outline page in a browser.                         |

## How sync tracking works

Every synced note carries metadata in its YAML frontmatter:

```yaml
---
outline_id: 7c2f4a91-8b3d-4e1f-9a2c-1d4e7f8a9b0c
outline_collection_id: a91b3c5d-7e9f-4a2b-8d6e-1f3a5b7c9e0d
outline_parent_id: null
outline_revision: 47
outline_url: https://outline.example.com/doc/some-slug-9pu19hcL3v
outline_synced_hash: 8f3a1b...
outline_last_synced: 2026-05-16T14:22:00Z
outline_sync_status: synced
outline_mapping_id: a3b2c1
outline_title: My Document
outline_attachments: '{"attachments/diagram.png":{"u":"https://...","h":"..."}}'
---
```

| Field                     | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `outline_id`              | Stable UUID of the Outline document. Immutable once set.                  |
| `outline_revision`        | Outline's revision counter at the last successful sync.                   |
| `outline_synced_hash`     | SHA-256 of the local body (frontmatter stripped) at the last sync.        |
| `outline_sync_status`     | `synced`, `conflict`, or `orphaned`.                                      |
| `outline_attachments`     | JSON map of `localPath` → `{ u: outlineUrl, h: contentHash }` for dedup.   |
| `outline_mapping_id`      | Which mapping this note belongs to.                                       |

A note's body is considered "locally changed" iff `sha256(body) != outline_synced_hash`. The remote is "changed" iff its revision counter is higher than `outline_revision`.

## Conflict workflow

When both sides change between syncs:

1. The remote version is written to `<note>.outline-conflict-<timestamp>.md`. It carries `conflict_for: <original-path>` in its frontmatter and is **not** itself synced.
2. The local file is marked `outline_sync_status: conflict` and skipped on subsequent syncs while the conflict file exists.
3. You resolve: open both files, edit the original to the desired merged content, then **delete the `.outline-conflict-*.md` file**.
4. The next sync pass sees the local change against the stable remote revision recorded at conflict time → it pushes your resolved version. ✓

Two override modes are available in **Sync behavior → Conflict behavior**:

- `prefer-local` — on conflict, push local and overwrite remote.
- `prefer-remote` — on conflict, pull remote and overwrite local.

Both bypass the conflict-file workflow. Use sparingly.

## Attachments

**Push (Obsidian → Outline).** When a doc is pushed, image refs like `![[diagram.png]]` or `![](attachments/diagram.png)` are detected. The plugin hashes the file bytes; if `(path, hash)` matches the `outline_attachments` map already in frontmatter, the cached Outline URL is reused with no upload. Otherwise the image is uploaded via Outline's attachment API and the new URL is recorded. Result: editing a doc 100 times still uploads the image just once.

**Pull (Outline → Obsidian).** When a doc is pulled, Outline-hosted attachment URLs (matching `/api/attachments.redirect`, `/api/files/`, or `/uploads/`) are detected. Each is downloaded into `<note-folder>/<attachmentFolderName>/`, named by attachment ID + content-type-derived extension, and the markdown is rewritten to use the local relative path. Multiple references to the same URL only download once.

The default attachment folder is `attachments/`. **Avoid leading-underscore names** — Remotely Save and similar plugins skip `_`-prefixed folders by default. Configurable in **Sync behavior → Attachment folder name**.

## Mobile

- The plugin manifest declares `isDesktopOnly: false`. Everything HTTP goes through `requestUrl`, and all file ops go through `app.vault` + `app.fileManager`, so iOS and Android are supported.
- Sync passes are resumable: per-mapping state is saved as each mapping finishes, so iOS killing a background task between mappings does not lose progress.
- The status bar (`◌ Outline sync…` / `✓ Outline`) is desktop-only; on mobile, use the **Show sync status** command.
- Mobile RAM is limited. The plugin avoids external dependencies (no `nanoid`, no hash library, no YAML parser beyond what's strictly necessary) for a small bundle.

## Security

- The API key is stored in plaintext in `<vault>/.obsidian/plugins/obsidian-outline-sync/data.json`.
- The key has your full Outline account access — treat accordingly.
- **Exclude `data.json` from any cloud sync** (Obsidian Sync, Remotely Save, iCloud, Dropbox). Example exclusion line for Remotely Save: `.obsidian/plugins/obsidian-outline-sync/data.json`.
- With debug logging enabled, console output may include document titles. Don't enable it during a recorded screenshare.

## Troubleshooting

| Symptom                                                                | Try                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Connection failed` on **Test connection**.                             | Verify the URL has the right protocol/host and the API key is current. For self-hosted Outline behind a VPN, check the device is on the VPN before sync.                                       |
| First sync of a large collection hits a rate limit.                     | The plugin paces requests against a rolling 1h window. Increase the **Rate limit buffer** to leave more headroom for ad-hoc UI calls, or split a huge collection into multiple smaller mappings. |
| A note isn't syncing — `Sync current note` reports "not part of a sync mapping". | The file lacks `outline_mapping_id`. Either it was never pulled by a mapping, or the field was deleted. Run `Rebuild local index` and try again.                                                |
| The wrong file got overwritten on a conflict.                          | Default conflict mode never overwrites your local content — it writes a sibling `.outline-conflict-*.md` file. If you changed the mode to `prefer-remote`, that's the cause; switch back.       |
| Attachments aren't appearing on the other device after sync.           | Your sync backend (Obsidian Sync, Remotely Save, iCloud, etc.) may be excluding the attachment folder. Make sure it's not on a skip-list — the default `attachments/` avoids the common `^_` pattern. |
| Pulled images render broken.                                           | The attachment fetcher couldn't reach the URL — usually a VPN/network issue. Re-run the sync once the connection is back; the dedup map will re-download missing files.                          |
| Local index is out of date after manual file moves.                    | Run `Rebuild local index from frontmatter`. The index is a cache; frontmatter is the source of truth.                                                                                          |

## Development

```bash
git clone https://github.com/GTez/obsidian-outline
cd obsidian-outline
npm install
npm run test     # 183 tests across 24 suites
npm run build    # type-check + production bundle
npm run dev      # watch mode for plugin development
```

### Scripts

| Script                 | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run dev`          | Build the plugin in watch mode (development).                        |
| `npm run build`        | Type-check and produce a production `main.js`.                       |
| `npm run test`         | Run the Jest test suite.                                             |
| `npm run format`       | Format all files with Prettier.                                      |
| `npm run format:check` | Check formatting without writing.                                    |
| `npm run generate:api` | Regenerate the Outline API client from the OpenAPI spec via Orval.   |

To install a development build inside Obsidian:

```bash
cp main.js manifest.json <vault>/.obsidian/plugins/obsidian-outline-sync/
```

Then reload the plugin in Obsidian (toggle off/on in Community Plugins).

### Testing

The test suite uses Jest with `ts-jest`. There are three layers:

- **Pure-logic unit tests.** URL parsing, filename sanitization, hierarchy mapping, hash, rate limiter, sync state machine.
- **Integration tests with a mocked transport** for the Outline API base.
- **End-to-end engine tests** using an in-memory `MemoryVault` and a `FakeApi`, driving the reconciler through pull/push/conflict/attachment scenarios.

There are deliberately no tests against the real Outline API — they belong in a separate manual test plan against a live instance. See **Manual test plan** below.

### Manual test plan

Before tagging a release, run through (against a non-production Outline instance):

1. Add a mapping for a single leaf document. Verify the file appears with full frontmatter.
2. Add a mapping for a doc with children. Verify the folder-note structure.
3. Edit a local file → sync. Verify Outline updated.
4. Edit a doc in Outline → sync. Verify the local file updated.
5. Edit both sides → sync. Verify a `.outline-conflict-*.md` file appears and `outline_sync_status: conflict` is set. Resolve, sync again. Verify clean.
6. Add a new child doc in Outline → sync. Verify created locally; if its parent was a leaf, verify it transitioned to a folder-note.
7. Move a doc in Outline → sync. Verify local file moved (and backlinks updated — check with `Open Graph view`).
8. Move a doc out of the mapped subtree → sync. Verify marked `orphaned`.
9. Embed a local image, push, edit text, push again. Verify only one Outline attachment was created (check Outline's attachment list).
10. Add an image in Outline, pull. Verify it lands in `attachments/` and renders locally.
11. On iOS: connect, set up a mapping, sync, force-kill, relaunch, sync again. Verify clean resume.
12. Toggle debug logging on; verify every sync decision is in the console with the `[outline-sync]` prefix.

## Architecture overview

See [`CLAUDE.md`](./CLAUDE.md) for the project's internal design and a contributor's guide oriented at AI coding agents.

## Contributors

- **[@defcon1702](https://github.com/defcon1702)** — Original author of the one-way push plugin (v1.x).
- **[@matthias-feddersen](https://github.com/matthias-feddersen)** — v1.8.0 refactor: pipeline architecture, callout conversion, typed API client.
- **Jesse Houston** ([@GTez](https://github.com/GTez)) — v2.0.0 bidirectional sync, mobile support, attachment round-trip, conflict workflow.

## License

MIT
