# Hermes UI - Extract the official renderer into one cross-platform app

`hermes-ui` is a thin UI wrapper over the Hermes dashboard/gateway server.
It is the official desktop app's React renderer, extracted and de-Electron-ified, shipped as a PWA first and later wrapped for mobile and desktop from a single codebase.

This is a deliberate pivot.
The previous plan proposed building a fresh Next.js + shadcn app from scratch; that approach is now obsolete and this document replaces it entirely.
This plan also supersedes `PLAN-hermes-mobile.md` (the Flutter plan).

The renderer we extracted is React 19 + Vite + Tailwind v4 + shadcn ("new-york") + Radix + nanostores + assistant-ui/streamdown.
It talks to the gateway over REST plus a JSON-RPC-over-WebSocket channel.
We are reusing the entire proven UI instead of reimplementing it, in any language.

## 1. Architecture

### 1.1 Extraction model

`hermes-ui` was produced by extracting the desktop renderer, not by writing a new client.
It lives at `$HOME/dev/hermes-apps/hermes-ui/` with this shape:

- `app/` - the extracted Vite renderer.
- `shared/` - the extracted `@hermes/shared` protocol client, pure TypeScript.
- `LICENSE` - MIT, Nous Research.
- `UPSTREAM.md` - provenance: extracted from `hermes-agent` commit `56a8e81d33a524f0ba0d68b6d54c8786ed283fb8` dated 2026-07-08; extraction date 2026-07-11.

The package manager is bun.

The extraction copied `hermes-agent/apps/desktop` (renderer) and `hermes-agent/apps/shared` into `hermes-ui/`, excluding all Electron machinery: `electron/`, `scripts/`, `packaging/`, `tsconfig.electron.json`, `node-pty`, `simple-git`, and `electron-builder`.

### 1.2 The remote-mode insight (why this is cheap and robust)

The renderer already ships a first-class "remote gateway" mode.
When the preload bridge's `getConnection()` returns `mode: 'remote'`, all filesystem and git operations route through the REST `api()` call instead of native Electron IPC, and the WebSocket client is already a plain browser `WebSocket`.

This is the key technical fact that makes the pivot work.
The web bridge did not reimplement features; it flipped an existing switch.
The browser build is the renderer running in the mode the desktop app already uses when it points at a gateway it does not host itself.

### 1.3 The web bridge

The desktop renderer expects a `window.hermesDesktop` preload bridge.
We wrote a browser implementation of that bridge in `app/src/web-bridge/` (`bridge.ts` + `install.ts`), installed as the FIRST import in `main.tsx` so it is present before any renderer code runs.

The bridge provides:

- A real `fetch`-based `api()`.
  It attaches `X-Hermes-Session-Token` in token mode and relies on same-origin cookies in gated mode.
  It reproduces the exact `"NNN: message"` error contract the renderer expects.
- A `getGatewayWsUrl()` that returns a token URL in token mode, or mints a single-use 30s ws-ticket per call in gated mode.
- `Notification` and clipboard access mapped to the corresponding Web APIs.
- Inert stubs for everything Electron-only: local terminal, native git, pet overlay window, auto-update, zoom, marketplace themes, and local filesystem dialogs.

Build-system changes that accompanied the bridge:

- `package.json` rewritten to a plain Vite web app with no Electron dependencies.
- `vite.config.ts` rewritten to drop the monorepo React aliases and the worktree filesystem hack, and to add a dev proxy for `/api`, `/auth`, and `/login` to a local gateway via `HERMES_GATEWAY_URL` (default `http://127.0.0.1:9119`).
- `tsconfig.json` rewritten to drop the Electron project reference.

`bun install` succeeded (866 packages), typecheck passes clean, and a production build is verified.
All of the above is milestone M0 and is done.

### 1.4 The same-origin constraint (critical)

The gateway blocks cross-origin browsers three separate ways.
Any browser deployment must therefore be same-origin with the gateway.

- CORS is hardcoded to localhost (`web_server.py:294-299`).
- Cookies are `SameSite=Lax`, HttpOnly, and host-only, so they are never sent cross-site.
- WebSocket upgrades reject foreign `http(s)` origins by closing with code 4403.

The important nuance for later platforms: non-http origins such as `capacitor://` are explicitly trusted by the WebSocket origin check, and `CapacitorHttp` bypasses CORS and SameSite entirely.
That is the escape hatch that lets a native wrapper talk to a remote gateway without upstream server changes.

## 2. Deployment models

Listed in priority order.
The build is a single-chunk Vite bundle.
`index.html` is present so the gateway can inject the session token before `</head>`.
This is not a Next.js static export, so any Next-specific framing from earlier planning does not apply here; assets live under `/assets/`, not `/_next/`, and the app is served at the domain root.

| Model | How | Origin story |
|---|---|---|
| A. Gateway-hosted (primary) | `bun run build` produces a static bundle; point `HERMES_WEB_DIST` at it; the gateway's `mount_spa()` serves it | Same origin. Cookies, CORS, and WS all just work. Token injection into `</head>` works |
| B. Dev | `bun run dev` on Vite with the proxy for `/api`, `/auth`, `/login` | Browser only talks to the Vite dev server, so effectively same-origin |
| C. Reverse proxy | A proxy serves the bundle and proxies `/api`, `/auth`, `/login` on one domain | Same origin on a single domain |
| D. Capacitor (later) | Native app; non-http origins like `capacitor://` are trusted by the WS origin check and `CapacitorHttp` bypasses CORS/SameSite | Cross-origin but native, so browser policies do not apply |

## 3. Multi-platform ship strategy

The vision is one codebase serving every platform, starting on day one.
The progression is PWA first, then Trusted Web Activity or Capacitor for stores, then an optional desktop wrapper.

### 3.1 PWA first

Add a web app manifest, a service worker, and icons.
The service worker caches the app shell only and must NEVER cache `/api`.

This makes the app installable on day one:

- Desktop via Chrome/Edge windowed install.
- Android via Add to Home Screen.
- iOS via Safari Add to Home Screen.

There is no separate mobile app to redirect users to.
The PWA is the mobile app.

For mobile browser visitors, surface an install prompt via `beforeinstallprompt`.
This is a nudge, not a forced redirect.
The earlier idea of "detect Android and redirect to a mobile app" is reframed here: no redirect is needed, because the same responsive PWA adapts to the device, and we simply offer to install it.

### 3.2 Store presence later

- Android: publish to the Play Store via a Trusted Web Activity (TWA) built from the same PWA, with roughly zero code change.
- Capacitor: the fallback when native APIs are needed beyond what a TWA or the browser exposes.
- Desktop: Tauri or Electron only if browser install proves insufficient.

### 3.3 Honest caveat on "mobile from day one"

The extracted renderer's UI is desktop-window-first today.
It is a three-pane shell with responsive tab collapsing, not a mobile-first layout.

"Mobile from day one" means installable from day one.
It does not mean the touch layout is finished.
A proper mobile layout pass is its own milestone and is not free.
That pass includes bottom navigation, bottom sheets instead of popovers, safe-area insets, `visualViewport` keyboard handling, larger touch targets, and swipe actions.

## 4. Feature parity and fate

Everything web-capable already works because the renderer is unchanged.

| Feature | Fate | Notes |
|---|---|---|
| Chat streaming, tool cards, reasoning | Works | Core runtime, unchanged |
| Approval / clarify / sudo / secret prompts | Works | Over WS RPC + events |
| Sessions CRUD | Works | REST + WS |
| Cron | Works | REST |
| Model switch | Works | REST + config |
| Skills, MCP | Works | REST |
| Settings, command center | Works | REST |
| Artifacts, agents, starmap | Works | Events + REST |
| Messaging, profiles | Works | REST |
| Voice | Works | Browser `MediaRecorder` |
| Local PTY terminal | Dropped | Electron-only |
| Local git review over IPC | Dropped | Works over REST if the gateway exposes `/api/git/*` |
| Native file dialogs | Dropped | Electron-only |
| Session pop-out OS windows | Dropped | Electron-only |
| Electron auto-update | Dropped | Electron-only |
| Transparent pet overlay window | Dropped | An in-app pet sprite could still render |

Feature-gating for the dropped capabilities (hiding or disabling the affected UI cleanly) is upcoming work, not yet done.

## 5. Milestones

### M0 - Foundation (DONE)

- Copied the `hermes-agent/apps/desktop` renderer and `hermes-agent/apps/shared` into `hermes-ui/`, excluding all Electron machinery (`electron/`, `scripts/`, `packaging/`, `tsconfig.electron.json`, `node-pty`, `simple-git`, `electron-builder`).
- Rewrote `package.json` (plain Vite web app, no Electron deps), `vite.config.ts` (removed monorepo React aliases and the worktree filesystem hack; added a dev proxy for `/api`, `/auth`, `/login` to a local gateway via `HERMES_GATEWAY_URL`, default `http://127.0.0.1:9119`), and `tsconfig.json` (dropped the Electron project reference).
- Wrote the browser `window.hermesDesktop` bridge in `app/src/web-bridge/` (`bridge.ts` + `install.ts`), installed as the FIRST import in `main.tsx`.
- `bun install` succeeded (866 packages), typecheck passes clean, and the production build is verified.

### M1 - Boot and auth verification against a real gateway

- Prove deployment model A end to end: `bun run build`, point `HERMES_WEB_DIST` at the bundle, load the app from the gateway with token injection working.
- Verify token mode (loopback) and gated mode (network bind): status probe, login, `GET /api/auth/me`, WS opens, `gateway.ready` received.
- Verify ws-ticket minting mints a fresh single-use ticket per connect and reconnect.
- Exit: a real session opens and streams against both auth modes of a real `hermes serve`.

### M2 - PWA layer

- Add the web app manifest, icons, and a service worker that caches the app shell only and never `/api`.
- Wire the `beforeinstallprompt` install nudge.
- Verify installability on desktop Chrome/Edge, Android Chrome, and iOS Safari.
- Exit: the app installs to the home screen on all three and launches standalone.

### M3 - Feature gating and web polish

- Cleanly gate or hide the dropped Electron-only surfaces (local terminal, native git, native file dialogs, session pop-out windows, auto-update, pet overlay window).
- Confirm git review falls back to REST where `/api/git/*` exists, and hides otherwise.
- Polish desktop-browser rough edges surfaced once the renderer runs outside Electron.
- Exit: no dead or broken controls in the browser build; every visible action works.

### M4 - Mobile layout pass

- Bottom navigation, bottom sheets replacing popovers, safe-area insets, `visualViewport` keyboard handling, larger touch targets, and swipe actions.
- Responsive collapse from the three-pane desktop shell down to a single-column mobile layout.
- Exit: the app is genuinely usable one-handed on a phone, not just installable.

### M5 - Capacitor / Android

- Add Capacitor; REST via `CapacitorHttp` (native, immune to CORS/SameSite); WS connects directly with the trusted `capacitor://` origin.
- Validate on real hardware the exact Origin header the WebView sends and that cookies persist across the native cookie jar and WS.
- Native niceties as needed: keyboard, status bar / safe area, haptics, share intents.
- Exit: an internal-track Android build authenticates against a remote gated gateway.

### M6 - Store release and optional desktop wrap

- Play Store via TWA (the lightest path) with Capacitor as the fallback where native APIs are required; then iOS.
- Evaluate a desktop wrapper (Tauri or Electron) only if browser install proves insufficient.
- Exit: a store-published build and a decision recorded on the desktop wrapper.

## 6. Risks and gotchas

- Same-origin constraint.
  CORS is hardcoded to localhost (`web_server.py:294-299`), cookies are `SameSite=Lax` HttpOnly host-only, and WS rejects foreign `http(s)` origins with close code 4403.
  Every browser deployment must be same-origin with the gateway; a cross-origin host will fail all three ways at once.
- Unversioned WS event contract.
  Parse defensively, ignore unknown event types and unknown keys, pin a tested Hermes version range, and gate features on `/api/status.version` when needed.
- Single-use WS tickets.
  Tickets have a 30s TTL and are single-use; mint a fresh ticket immediately before every connect and reconnect and never reuse a connect URL.
- `prompt.submit` is fire-and-forget.
  The ack is immediate and turn state is driven entirely by events; keep one in-flight submit per session.
- Mobile browser lifecycle.
  Backgrounded tabs freeze timers and kill sockets; reconnect on `visibilitychange`, `pageshow`, and `online` with a fresh ticket and a resync.
- iOS Safari PWA limitations.
  It is the harshest environment for standalone PWAs and background sockets; test there early rather than at the end.
- Ported-code drift versus upstream.
  The renderer and shared client will drift as `hermes-agent` evolves.
  `UPSTREAM.md` records the source commit `56a8e81d33a524f0ba0d68b6d54c8786ed283fb8`; re-diff against upstream on every Hermes upgrade.
- Gateway asset-path rewrites.
  The gateway's `mount_spa()` rewrites are Vite-style (`/assets/`), not Next (`/_next/`).
  Serve the app at the domain root so paths resolve; a reverse-proxy subpath would need extra handling.
