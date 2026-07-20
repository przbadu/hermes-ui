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
- The `components/pane-shell/tree/*` layout-engine rewrite (this repo still uses the pre-tree `pane-shell`).
- The `store/session-states` extraction and the expanded `store/session` API that depends on it.
- The expanded `types/hermes.ts` / `global.d.ts` surface: `cloud` gateway mode + custom endpoints, terminal-backend picker, worktree base-branch, per-job cron model. These require matching `web-bridge` work.
- The `@assistant-ui/react` 0.12 -> 0.14 (+ `react-streamdown` 0.1 -> 0.3) major upgrade, which the new markdown/runtime code needs.
- **Billing** (`app/settings/billing/*`, `shared/billing-*`, `charge-settlement`): intentionally excluded from the web build per project decision; skip on future syncs unless that decision changes.

When picking up PR2, start from the deferred list above rather than re-diffing from `56a8e81`.
