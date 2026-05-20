# Changelog

All notable changes to this project will be documented in this file.

## [2.2.1] – 2026-05-20

### Fixed

- **Lone-backslash lines from Outline's empty paragraphs were rendering
  as literal `\` in the vault.** Outline's ProseMirror-based markdown
  serializer emits empty paragraphs as a single backslash on its own
  line. The pull-side blank-line normalizer now treats those as blanks
  and collapses them along with the surrounding whitespace. Content-line
  hard breaks (`foo\`) and lone backslashes inside fenced code blocks
  are preserved.

## [2.2.0] – 2026-05-20

### Fixed

- **Pull-side attachments with host-relative URLs were silently dropped.**
  Outline can serialize image links with relative URLs like
  `![](/api/attachments.redirect?id=…)`. The filter only accepted
  absolute URLs on the configured Outline host, so relative ones were
  left as broken refs in the vault. Relative URLs are now resolved
  against `outlineUrl` and downloaded normally.
- **Image-link parser conflated URL and title.** Links of the form
  `![alt](url "title")` were captured as a single URL group, which
  mangled the fetched URL whenever Outline emitted title metadata.
  The parser now follows CommonMark and splits URL from optional title.

### Changed

- **Attachments now live in one centralized vault folder.** Pulled
  attachments go to a single `Extras/Outline-Sync/Attachments/`
  directory (configurable) instead of per-note `attachments/` siblings.
  The setting `attachmentFolderName` is replaced by `attachmentsPath`.
  Existing users who previously pulled attachments will see a one-time
  re-upload on the next push (the dedup cache is keyed by local path).

### Added

- **Outline image-size metadata is translated to Obsidian syntax.**
  When Outline serializes an image as `![](url "right-50 =304x171")`,
  the size hint `=304x171` is now rendered into the local link as
  Obsidian's pipe-separated size syntax (`![|304x171](path)`).
  Alignment tokens like `right-50` are not portable and are dropped.

## [2.1.0] – 2026-05-19

### Added

- **Sync on save (experimental).** New setting re-syncs the active mapping
  after the file is modified, debounced by a configurable number of
  seconds (default 10). Disabled by default; the debounce is what makes
  it usable with Obsidian's frequent auto-save.

### Fixed

- **Extra blank lines between blocks on pull.** Outline's markdown
  serializer emits multiple blank lines between top-level blocks; the
  pull pipeline now collapses runs of three or more newlines to exactly
  two, preserving content inside fenced code blocks verbatim.

### Changed

- Author renamed from `GTez` to `Jesse Houston` in `manifest.json`,
  `package.json`, and the README contributors entry. The GitHub repo
  URL is unchanged.

## [2.0.0] – 2026-05-16

### Added — Bidirectional sync

The plugin can now sync in both directions between Obsidian and Outline, not
just push. Highlights:

- **Sync mappings.** Each mapping pairs an Outline document or collection
  subtree with a vault folder. Multiple mappings supported.
- **Folder-note hierarchy.** Outline documents with children become folders
  containing a same-named markdown file, matching the [Folder Notes](https://github.com/LostPaul/obsidian-folder-notes)
  convention. Leaves stay as plain files.
- **Conflict-safe.** When both sides change between syncs, the remote
  version is written to `<file>.outline-conflict-<timestamp>.md`; the
  local file is marked `outline_sync_status: conflict` and skipped until
  the conflict file is deleted. Configurable to `prefer-local` /
  `prefer-remote` for power users.
- **Mobile support.** All HTTP routes through `requestUrl`; manifest now
  declares `isDesktopOnly: false`. Tested on iOS and Android.
- **Rate-limited.** Rolling 1-hour window keeps us safely under Outline's
  default 1000 req/hr limit. Configurable headroom buffer.
- **Title / move detection.** Title changes in Outline rename the local
  file (and folder, for folder-notes), preserving backlinks via
  `fileManager.renameFile`. Docs moved within a mapped subtree are
  relocated; docs moved out are marked orphaned, not deleted.
- **Local index.** `.obsidian/plugins/obsidian-outline-sync/index.json`
  caches the outline-id → vault-path map; rebuildable from frontmatter.

### Commands

- Sync all mappings
- Sync current note
- Show sync status
- Force pull (overwrite local) / Force push (overwrite remote)
- Rebuild local index from frontmatter
- Open current note in Outline

The legacy one-way push commands ("Push active file to Outline",
"Push folder to Outline") are preserved.

### Internals

- New `src/bisync/` module: engine, reconciler, walker, hierarchy mapper,
  conflict handler, hash, local index, vault IO abstraction.
- `OutlineApiBase` extended with `listDocuments`, `getCollectionDocumentTree`,
  `getCollection`, `deleteDocument`.
- `customInstance` now supports a pluggable `RateLimiter` and exponential
  5xx backoff in addition to the existing 429 retry path.
- Frontmatter schema extended: `outline_revision`, `outline_synced_hash`,
  `outline_parent_id`, `outline_url`, `outline_sync_status`,
  `outline_mapping_id`, `outline_title`, `conflict_for`.
- 171 unit + integration tests covering URL parsing, sanitization, the
  reconciliation state machine, the conflict flow, the engine glue.

## [1.8.0] – 2026-03-16

### Added / Changed – Major refactor by [@matthias-feddersen](https://github.com/matthias-feddersen)

A huge thank you to **Matthias Feddersen** for his substantial contribution to this release.
He refactored large parts of the codebase and added significant new capabilities:

- Modular pipeline architecture for Markdown transformers
- Improved callout conversion (info, warning, success, tip)
- Optional table-of-contents removal (plugin setting + `REMOVE_TOC` CLI env var)
- CLI runner (`npm run sync`) to push folders without Obsidian
- Auto-generated, fully typed Outline API client via Orval + OpenAPI spec
- Adapter pattern separating Obsidian and Node.js environments
- Comprehensive test suite (Jest) covering pipeline, callouts, frontmatter, images, TOC, wiki-links, document tree, folder sync
- Fix: internal wiki-links resolved correctly
- Fix: empty pages no longer disrupt folder/document tree structure
- Improved sync progress display and logging
- Prettier formatting setup

## [1.7.0] – 2026-03-?

- i18n: All UI strings switched to English

## [1.6.0] – 2026-03-?

- fix: Image upload fully repaired

## [1.5.1] – 2026-03-?

- fix: Two-step image upload – documentId known before upload

## [1.5.0] – 2026-03-?

- security: Audit corrections (all 8 points addressed)

## [1.4.0] – 2026-03-?

- feat: Nested folder structure via `parentDocumentId`

## [1.3.1] – 2026-03-?

- fix: Conflict modal also triggered when `outline_id` is already known

## [1.3.0] – 2026-03-?

- feat: Conflict modal with overwrite / duplicate-suffix option

## [1.2.0] – 2026-03-?

- feat: Duplicate handling via `documents.search`

## [1.1.1] – 2026-03-?

- fix: `validateConfig` no longer checks `targetCollectionId`

## [1.1.0] – 2026-03-?

- feat: Collection-Picker modal + collections cached on startup

## [1.0.0] – 2026-02-20

- Initial release: full plugin foundation implemented
