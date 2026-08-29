# Provenance

`app/` and `shared/` are extracted from the Hermes Agent monorepo (MIT licensed, Copyright (c) 2025 Nous Research; see `LICENSE`).

- Upstream: `hermes-agent` repository, `apps/desktop` and `apps/shared`.
- Extracted at upstream commit: `56a8e81d33a524f0ba0d68b6d54c8786ed283fb8` (2026-07-08).
- Extraction date: 2026-07-11.

## What was changed from upstream

- Removed everything Electron: `electron/`, `scripts/`, `packaging/`, `tsconfig.electron.json`, electron/electron-builder deps and scripts, native deps (`node-pty`, `simple-git`).
- `package.json` rewritten for a plain Vite web app (renamed `hermes-ui`).
- `vite.config.ts`: removed monorepo-root react aliases and worktree fs.allow hack; added a dev proxy for `/api`, `/auth`, `/login` to a local gateway (`HERMES_GATEWAY_URL`, default `http://127.0.0.1:9119`).
- `tsconfig.json`: dropped the Electron project reference.
- Added a web implementation of the `window.hermesDesktop` preload bridge (see `app/src/web-bridge/`); web-capable methods are real, Electron-only methods are stubbed behind a capability flag.

## Re-syncing with upstream

Diff `hermes-agent/apps/desktop/src` against `app/src` (and `apps/shared/src` against `shared/src`) from the recorded commit forward, and re-apply upstream changes.
Keep local modifications minimal and centralized in `src/web-bridge/` so upstream diffs stay clean.

## Sync log

This is the running watermark for incremental upstream syncs.
When you sync, always diff upstream `apps/desktop/src` + `apps/shared/src` from the **Last synced commit** below forward, port the web-applicable changes, then bump the watermark.

- **Last synced upstream commit:** `f0aae14c684a84cd1eeca88339238406c30f3ed7` (2026-07-20).
- **Last sync date:** 2026-07-20.
- **Baseline before this sync:** `56a8e81` (the original extraction).

### 2026-07-20 - partial sync of the 2026-06-29 -> 2026-07-20 window (merged desktop PRs)

Full re-sync was staged. This sync landed the self-contained perf/fix/feature improvements that map onto files already in this repo, and deliberately deferred the large architectural changes to a follow-up.

**Ported (this repo now matches upstream `f0aae14` for these):** perf improvements to the thread/streaming/tool-render path, sidebar/session slices, layout-thrash fixes, markdown streaming, and many leaf stores, libs, hooks, and components; plus i18n string updates and the `shared/` changes.

**Deferred to a follow-up (PR2) - do NOT assume these are synced:**
- The `contrib`/plugin system that absorbed `desktop-controller`, `app-shell`, and `keybind-panel` (these files are kept in their pre-refactor web-adapted form here).
- The session-tab lifecycle and expanded `store/session` API. The layout port below includes only the compatibility surface needed by the tree renderer.
- The expanded `types/hermes.ts` / `global.d.ts` surface: `cloud` gateway mode + custom endpoints, terminal-backend picker, worktree base-branch, per-job cron model. These require matching `web-bridge` work.
- The `@assistant-ui/react` 0.12 -> 0.14 (+ `react-streamdown` 0.1 -> 0.3) major upgrade, which the new markdown/runtime code needs.
- **Billing** (`app/settings/billing/*`, `shared/billing-*`, `charge-settlement`): intentionally excluded from the web build per project decision; skip on future syncs unless that decision changes.

When picking up PR2, start from the deferred list above rather than re-diffing from `56a8e81`.

### 2026-08-19 - Bot Mode port from upstream `v2026.8.18` (issue #34)

This port brings upstream's Bot Mode (the bundled `hermes-bots` plugin) plus the minimum plugin-system machinery it needs, WITHOUT the full PR2 architectural sync.
The general watermark above is unchanged - only the files below track `v2026.8.18` (`e624e9f`).

**Ported verbatim from upstream `apps/desktop/src` at `v2026.8.18`:**
- `contrib/` framework: `types.ts`, `registry.ts`, `events.ts`, `plugins-store.ts`, `index.ts`, `react/{boundary,contribute,slot,use-contributions}` (+ `slot.test.tsx`).
- `plugins/hermes-bots/plugin.js` (byte-identical) + its `tests/` (run via `npm run test:plugins` under `node --test`, excluded from vitest).
- `app/chat/composer/contrib.ts` (minus the `microActions` provider surface, which needs the unported `store/composer-actions`).
- `app/command-palette/contrib.ts`, `i18n/plugin-i18n.ts`, `lib/budgeted-loop.ts`, `lib/renderer-loop-pause.ts`.

**Web-adapted (documented in-file):**
- `contrib/plugin.ts`: `ctx.socket` is a no-op disposer, `ctx.os.notify`/`revealPath` are inert, `ctx.rest` rides the web bridge `api` (no multipart `upload` yet).
- `contrib/plugins.ts`: bundled discovery only - the disk-door `runtime-loader` is omitted (needs desktop fs watchers).
- `sdk/index.ts` (`@hermes/plugin-sdk` alias): web host - single-connection (no `agents`/`connections`/`ensureAgent`/`requestProfile`/`openWorkspace`), no `SkillsView`/`McpTab`/`ToolsetConfigPanel` exports (the web versions lack `fixedProfile` scoping; plugins use their profile-correct staged fallbacks). Its temporary pane-host visibility adapter was superseded by the layout port below.
- `app/contrib/pane-host.tsx` (new, web-only at the time): mapped pane contributions onto the fixed shell. It was removed when the Desktop tree engine was ported below.
- `store/gateway.ts`: added `retireProfileGateway` (upstream `retireLocalProfileGateways` analog) so a profile delete can't be resurrected by its own socket (upstream #52279).

**Seams cut into existing files:** composer submit middleware (`runComposerMiddleware` in `app/chat/composer/index.tsx`), contributed `@` completion sources (`hooks/use-at-completions.ts`), contributed palette rows (`app/command-palette/index.tsx`), plugin boot + right panes (`app/desktop-controller.tsx`), sidebar tab strip (`app/chat/sidebar/index.tsx`), `pluginRest` (`hermes.ts`), plugin i18n re-exports (`i18n/index.ts`).

**Still deferred (on top of the PR2 list):** `Settings > Plugins` page (plugins can only be toggled via the persisted `hermes.desktop.pluginDecisions.v2` storage key for now), `contrib/runtime-loader.ts`, `store/composer-actions` + composer micro-actions, `blobatarSvg` avatars (not present upstream at this tag either - the plugin's classic-shapes fallback renders).

### 2026-08-28 - Desktop layout engine and editor port (PR #37)

This scoped sync ports the production layout system from Hermes Desktop at `6da0ae1cf5a37898a046b644cf23f9fe67baba22`. It supersedes the fixed-shell pane host and the temporary web-only layout picker.

**Ported from `apps/desktop/src`:** the tree model/store/renderer, grid editor and conversions, preset layout picker, edit mode, pane lifecycle/visibility, tab-strip preferences, pointer/drag helpers, and the current Default, Focus, Terminal deck, and Quad presets. Contributed panes now use the same layout registry and visibility state as Desktop.

**Web adaptations:** Desktop's tree remains the single layout model. At narrow widths, collapsible left and right zones render as touch drawers with edge-swipe navigation and backdrop dismissal; this responsive presentation does not introduce separate mobile presets or state. Drawer navigation closes the whole active zone (including the Bots tab), and dynamic plugin panes are re-adopted from their Desktop dock hints instead of stale preset placeholders. The web bridge also retains Desktop's explicit session-owner hint when a hidden Bot Chat opens, so its REST and resume calls stay on the owning profile. Electron-only session-tile cleanup is represented by a documented no-op compatibility function until session tabs are ported.

**Still deferred:** the remaining contrib/controller refactor, full session-tab lifecycle, expanded bridge surfaces, dependency major upgrades, plugin settings/runtime loading, and Billing.
