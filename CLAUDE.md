# CLAUDE.md

Project-specific guidance for AI coding agents working on this repo. Human contributors can read it too — it's the fastest way to understand the architecture.

## What this is

An Obsidian plugin that bidirectionally syncs the user's vault with an [Outline](https://www.getoutline.com/) knowledge base. The README covers the user-facing surface; this file covers the code.

## Top-level layout

```
src/
  plugin-ui/         Obsidian-specific UI: main.ts (Plugin entry), settings tab, modals
  bisync/            The bidirectional sync engine. Talks to VaultIO + IOutlineApi.
  outline-api/       Typed API client + rate limiter. The generated client lives here.
  pipeline/          Markdown transformers (frontmatter parser, image detector,
                     callouts, wikilinks). v2 only uses the image detector and
                     frontmatter utilities; the rest are kept as a small library
                     in case future v2 push needs them.
tests/               Jest suite. helpers/ has MemoryVault + FakeApi.
```

`src/bisync/` is the heart of v2. Each file is single-purpose and small. Read them in this order to onboard:

1. `vault-io.ts` — the IO interface the engine uses. Two implementations: `obsidian-vault-io.ts` (production) and `tests/helpers/memory-vault.ts` (tests).
2. `local-index.ts` + `index-storage.ts` — the persistent `outlineId → vaultPath` map.
3. `url-parser.ts`, `sanitize.ts`, `hierarchy.ts` — pure logic for source resolution + folder layout.
4. `walker.ts` — fetches an Outline subtree.
5. `change-detection.ts`, `hash.ts` — what "local has changed" means.
6. `pusher.ts`, `puller.ts`, `attachments.ts` — directional primitives.
7. `conflict.ts` — conflict file format and detection.
8. `reconciler.ts` — the state machine. Most of the interesting logic.
9. `engine.ts` — the orchestrator the plugin holds.

## Architecture invariants

These are the rules the code keeps. If you find yourself fighting one, you're probably about to break sync.

### 1. Hashes are over disk content, not network content

`outline_synced_hash` is `sha256(body-as-it-sits-on-disk-with-frontmatter-stripped)`. Both pull and push end with the local file in a state where re-hashing it yields the stored value. This is what lets `(local_changed, remote_changed)` reduce to two boolean comparisons.

Specifically:

- **Pull**: download remote body → process attachments (rewrite to local refs) → write to disk → `outline_synced_hash = sha256(rewritten body)`.
- **Push**: read disk body → upload attachments (rewrite to remote refs) → send to Outline → leave disk untouched → `outline_synced_hash = sha256(disk body)`.

Never hash the body you sent to Outline. Outline canonicalizes markdown server-side; the sent body's hash is wrong on the next pass.

### 2. Local file uses local refs; Outline stores Outline URLs

After a successful round-trip, the local file references `attachments/foo.png` and the Outline document references `https://outline.example.com/api/attachments.redirect?id=...`. The two are never "the same string." `outline_synced_hash` is over the local-refs form, so a re-pull (which downloads attachments + rewrites to local refs) produces the same string and the same hash.

### 3. Outline API responses are the source of truth for revisions

After `documents.update`, read `response.document.revision` and store it. Do not compute or guess it. Same for `documents.create`. The `pushUpdate` / `pushCreate` helpers in `pusher.ts` already do this; don't bypass them.

### 4. Renames use `app.fileManager.renameFile`, not `vault.rename`

The former rewrites backlinks in other notes; the latter does not. This matters because notes in the synced subtree frequently link to each other. `ObsidianVaultIO.rename` uses the file manager path.

### 5. Frontmatter writes go through `app.fileManager.processFrontMatter`

It's the only YAML editor that survives all of Obsidian's edge cases (quoting, datetime parsing, custom user fields). The simple parser in `pipeline/transformers/frontmatter.ts` is **read-only** and exists for tests + the legacy parse path.

`outline_attachments` is stored as a JSON-stringified value (one frontmatter line), specifically so the simple parser can roundtrip it without growing nested-object support.

### 6. The local index is a cache

`.obsidian/plugins/obsidian-outline-sync/index.json` is rebuilt from frontmatter on demand (`rebuildIndex` command). If you're tempted to put load-bearing data only in the index, don't.

### 7. Mobile constraints

- No `fs`, no `child_process`, no raw `fetch`. All HTTP is `requestUrl`; the orval-generated client routes through `customInstance.ts` which uses a pluggable `Transport` so the same generated code works on both desktop (via `requestUrl`) and Node (via `fetch`, used by tests).
- No external runtime deps. The mobile bundle is one file; every added package shows up in user memory. `sha256` uses Web Crypto. `nanoid` is a tiny local implementation (`src/bisync/nanoid.ts`). The YAML parser is hand-rolled and only handles flat scalars.
- `manifest.json` must keep `isDesktopOnly: false`.
- Status bar APIs return `null` on mobile — wrap in a try/catch (`main.ts` already does this).

### 8. Push is idempotent at the attachment layer

The `outline_attachments` frontmatter field (`{ localPath: { u, h } }`) lets the pusher skip uploads when image bytes haven't changed. If you change the upload flow, preserve this — the original v2 attachment commit accumulated duplicates on every push, and it was a bug, not a feature.

## When you're changing the reconciler

The state machine is `(local_changed, remote_changed)` → one of `noop | pull | push | conflict`. The full code path for each branch is in `reconciler.ts`. There are tests for every branch in `tests/reconciler.test.ts` and the conflict flow has a dedicated three-pass test in `tests/conflict.test.ts`.

Conventions:

- Emit a `ReconcileEvent` for every doc you touch. The plugin renders these as user-facing notices and the test suite asserts on them.
- Don't bypass `pushUpdate` / `pushCreate` / `processOutboundImages` — they handle the response-hashing and dedup invariants for you.
- When you add a new frontmatter field, update three places: the `OutlineFrontmatter` interface, the simple parser in `pipeline/transformers/frontmatter.ts`, and `applyFrontmatterUpdates` in `src/frontmatter.ts`. The first is the type; the second is for reading on the push side; the third is for writing.

## When you're changing the API client

The typed client (`src/outline-api/generated-client/`) is generated by [Orval](https://orval.dev/) from `outline-openapi-spec3.json`. Don't hand-edit the generated file — it'll lose changes on the next regen.

The way to extend coverage:

1. Add a method to `OutlineApiBase` (`src/outline-api/outline-api-base.ts`) that wraps the generated function and adapts error handling.
2. Add the method to the `IOutlineApi` interface (`src/outline-api/types.ts`).
3. Add a fake implementation to `tests/helpers/fake-api.ts`.
4. Use it from the engine via `IOutlineApi`, never directly from the generated client.

Rate limiting lives in `rate-limiter.ts`. It's a rolling 1h window with a configurable buffer; concurrent acquires are serialized through a promise chain so two parallel callers can't race past the ceiling.

## Testing

```bash
npm test            # full Jest suite
npm test -- foo     # run one suite
```

The test suite is fast (~4s for 183 tests). Three layers:

1. **Pure unit tests.** URL parser, sanitizer, hierarchy, hash, rate limiter, sync state machine branches.
2. **API base** against a mock transport.
3. **End-to-end engine tests** driving the reconciler against `MemoryVault` + `FakeApi`. Add new scenarios here — they're cheap.

Conventions:

- One test file per source module (e.g. `walker.ts` → `walker.test.ts`).
- Each behavioral branch gets its own `test(...)` block.
- For new features, prefer adding to `reconciler.test.ts` or `conflict.test.ts` over creating new files unless the feature warrants it.
- Use `MemoryVault.seed(path, raw)` to pre-populate files with frontmatter; the helper parses the YAML the same way Obsidian would. Use `seedBinary` for images.

Real-API integration tests are intentionally not part of the automated suite. They go in the **Manual test plan** in the README.

## Code conventions

- Strict TypeScript. `noImplicitAny`, `strict: true`. Avoid `any`; use `unknown` and narrow.
- No top-level side effects in modules. Plugin lifecycle in `main.ts`; module-level code should be type/declaration only.
- Per the project rule of "no comments unless WHY is non-obvious", lean on naming. Use comments when the *next* maintainer would otherwise re-derive a non-trivial decision (e.g. "we hash the response body, not the sent body — Outline canonicalizes server-side"). Skip them when the code reads cleanly.
- Use the existing `applyFrontmatterUpdates` rather than building YAML by hand.

## Common tasks

### Add a new command

In `src/plugin-ui/main.ts`, `registerCommands()`. Mirror the existing pattern (`checkCallback` for context-sensitive commands; `callback` for global ones).

### Add a setting

Three places:

1. `OutlineSyncSettings` interface in `src/settings.ts` and `DEFAULT_SETTINGS`.
2. Render a `Setting(parent)` row in the appropriate section of `src/plugin-ui/setting-tab.ts`.
3. Read it from `getSettings()` wherever it's consumed (typically the engine).

### Bump the version

Edit `manifest.json`, `package.json`, and `versions.json`. Add a CHANGELOG entry.

### Regenerate the API client

```bash
# Replace src/outline-api/outline-openapi-spec3.json with the latest spec
npm run generate:api
```

## Things that look like bugs but aren't

- **Push doesn't write back to the local file.** Intentional — see invariant 1. The disk body and Outline's stored body diverge by design (local refs vs Outline URLs); the synced hash bridges them.
- **A doc's `outline_revision` jumps by 2 after a push.** First update bumps the revision; if there were images, the second update bumps it again.
- **Conflict file appears alongside an unchanged-looking local file.** Both sides changed, but maybe the local "change" was just an Obsidian auto-save that rewrote the file with the same content but different EOL or whitespace. Look at the conflict file's body to see what Outline thinks the world looks like.
- **Sync interval doesn't fire on mobile after backgrounding.** iOS / Android kill background JS. The plugin will resume on next foreground; running an explicit sync command works at any time.

## See also

- [README.md](./README.md) — user-facing setup, commands, troubleshooting.
- [CHANGELOG.md](./CHANGELOG.md) — version history. v2.0.0 is the bidirectional rewrite.
