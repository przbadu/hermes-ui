# hermes-ui

`hermes-ui` is a thin browser UI wrapper over the Hermes gateway.
It is the official Hermes desktop renderer, extracted from the `hermes-agent` monorepo and repackaged as a plain Vite web app so the same UI can be served from a browser instead of Electron.
It ships no backend of its own: every request (REST, auth, and the WebSocket) goes to a running Hermes gateway.

## Demo

A short walkthrough of the UI running against a Hermes gateway — login, chat, the model picker, themes, and settings.

<video src="https://github.com/przbadu/hermes-ui/raw/main/assets/hermes-ui-demo.mp4" controls muted width="100%"></video>

> If the player above does not render (some Markdown viewers do not support inline video), [watch or download the demo directly](assets/hermes-ui-demo.mp4).

For the extraction plan and provenance, see:

- [PLAN.md](PLAN.md) - the plan behind this repo.
- [UPSTREAM.md](UPSTREAM.md) - upstream commit, what was changed, and how to re-sync.

## Repo layout

- `app/` - the Vite web app (React + TypeScript). Builds to `app/dist/`.
- `shared/` - shared TypeScript sources consumed by `app/` via the `@hermes/shared` alias.
- `bin/dev`, `bin/prod` - zero-setup runners (install, build, and start in one command).
- `UPSTREAM.md`, `LICENSE` - provenance and license (MIT, Copyright (c) 2025 Nous Research).
- `scripts/serve-on-gateway.sh` - helper that points a gateway at the built `app/dist/` and starts it.

## Prerequisites

- [bun](https://bun.sh) as the package manager and script runner.
- A running Hermes gateway (`hermes serve` or `hermes dashboard`, FastAPI, default port `9119`).

## Quick start

Two runners install dependencies and start the app with no manual setup.

```sh
cd $HOME/dev/hermes-apps/hermes-ui

./bin/dev    # dev server with hot reload; open http://127.0.0.1:5174
./bin/prod   # build, then serve the bundle from the gateway (same-origin)
```

`bin/dev` proxies to `http://127.0.0.1:9119` by default; override with `HERMES_GATEWAY_URL=http://host:port ./bin/dev`.
`bin/prod` passes any extra arguments through to `hermes serve`, for example `./bin/prod --port 9200`.

For gateways using OAuth, prefer `bin/prod`: the login redirect must return to the same origin the app was served from, which the gateway-hosted path guarantees.

The gateway is meant to run on loopback (`127.0.0.1`, the default). Run the UI and the gateway on the same machine and reach it at `127.0.0.1`.

## Automated setup (for Hermes / AI agents)

If you are an AI agent (Hermes, Claude Code, and similar), or you are asking one to set this up, follow [AGENTS.md](AGENTS.md).
It is a step-by-step runbook covering preflight checks, build, serving the bundle from the gateway (the manual path), verification, and rebuild.

The short version, from the repo root:

```sh
cd app && bun install && bun run build   # build the static bundle
cd .. && ./bin/prod                       # serve it from the gateway (same-origin)
```

The runbook deliberately covers only the manual path; an agent should not install or modify systemd services unless you explicitly ask.

## Choosing the gateway from inside the app

The connection is editable at runtime in Settings -> Gateway, exactly like the desktop app.
It defaults to the origin the app was served from, so the gateway-hosted and dev-proxy paths need no configuration.
You can point it at another gateway URL (an absolute `https://host` or a `/prefix` path on the serving origin) and choose token or OAuth authentication; the choice is saved in the browser.
The same-origin constraint below still applies to whatever URL you enter.

## Why same-origin is mandatory

The gateway is locked down to same-origin browsers and cannot be talked to cross-origin:

- CORS is hardcoded to localhost origins, so a browser served from any other origin is rejected.
- Session cookies are `SameSite=Lax`, so they are not sent on cross-site requests.
- The WebSocket rejects foreign origins and closes the connection with close code `4403` (see `hermes-agent/hermes_cli/web_server.py:15308`).

Serving the built bundle from the gateway itself (option A) makes the UI, REST, auth, and WebSocket all share one origin, so cookies, CORS, and the WebSocket all work with no extra configuration.
The dev proxy (option B) and a reverse proxy (option C) are the two ways to preserve that same-origin property without hosting on the gateway directly.

## How the gateway hosts the bundle

The gateway's `mount_spa()` serves a static directory selected by the `HERMES_WEB_DIST` environment variable:

- The directory is read from `HERMES_WEB_DIST` and falls back to a bundled `web_dist` when the variable is unset:
  `WEB_DIST = Path(os.environ["HERMES_WEB_DIST"]) if "HERMES_WEB_DIST" in os.environ else Path(__file__).parent / "web_dist"` (`hermes-agent/hermes_cli/web_server.py:121`).
- The bundle's `assets` subdirectory is mounted at `/assets`, so the gateway expects `<HERMES_WEB_DIST>/assets` to exist:
  `application.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")` (`hermes-agent/hermes_cli/web_server.py:15678`).
- All other paths fall back to `<HERMES_WEB_DIST>/index.html` for SPA client-side routing (`hermes-agent/hermes_cli/web_server.py:15694-15703`).
- Before serving `index.html`, the gateway injects the session token as `window.__HERMES_SESSION_TOKEN__` in a `<script>` tag placed just before `</head>` (`hermes-agent/hermes_cli/web_server.py:15634,15649`), so the SPA can authenticate against protected endpoints in loopback/token mode.

Note: `hermes serve` respects `HERMES_SERVE_HEADLESS=1` and will refuse to serve the SPA when it is set (`hermes-agent/hermes_cli/web_server.py:15592-15593`); leave it unset to host the UI.

The Vite build uses `base: './'` (`app/vite.config.ts:13`), so asset URLs in the built `index.html` are relative (for example `./assets/index-*.js`), which resolves correctly when the bundle is served at the domain root.

## Three ways to run

### A. Gateway-hosted production (recommended)

Build the bundle, then start the gateway with `HERMES_WEB_DIST` pointing at the absolute path of `app/dist`.

```sh
cd $HOME/dev/hermes-apps/hermes-ui/app
bun install
bun run build
```

Then start the gateway with the built bundle:

```sh
HERMES_WEB_DIST=$HOME/dev/hermes-apps/hermes-ui/app/dist hermes serve
```

Or use the helper, which resolves the absolute path and exports the variable for you:

```sh
$HOME/dev/hermes-apps/hermes-ui/scripts/serve-on-gateway.sh
```

Open the gateway's URL (default `http://127.0.0.1:9119`).
Because the UI is served by the gateway, everything is same-origin: cookies, CORS, and the WebSocket all work, and the gateway injects the session token into `index.html` automatically.

`HERMES_WEB_DIST` must be an absolute path.

### B. Dev with the Vite proxy

For local development with hot reload, run the Vite dev server.
The browser only ever talks to the Vite origin (`http://127.0.0.1:5174`); Vite proxies `/api`, `/auth`, and `/login` (including the WebSocket upgrade) to the gateway, keeping the browser same-origin with the dev server.

```sh
cd $HOME/dev/hermes-apps/hermes-ui/app
bun install
bun run dev
```

The proxy targets `http://127.0.0.1:9119` by default.
If the gateway runs on a different host or port, set `HERMES_GATEWAY_URL` before starting the dev server:

```sh
HERMES_GATEWAY_URL=http://127.0.0.1:9200 bun run dev
```

### C. Reverse proxy

If you want to serve the UI from your own web server, host the contents of `app/dist/` as static files and proxy `/api`, `/auth`, and `/login` (with WebSocket upgrade support on `/api`) to the gateway, all under one domain.
Serving the static files and proxying the API paths on the same origin preserves the same-origin property the gateway requires.

## Troubleshooting

- Blank page or 404 on assets: `HERMES_WEB_DIST` is wrong or not absolute. It must be the absolute path to `app/dist`, and that directory must contain both `index.html` and an `assets/` subdirectory.
- WebSocket closes with code `4403`: the app is not same-origin with the gateway. Serve it via option A, B, or C so the browser origin matches the gateway.
- Cross-origin fetch failures (CORS errors, missing cookies): same root cause as the `4403` case - the UI is being served from an origin the gateway does not trust. Make it same-origin.
- `hermes serve` returns 404 JSON for every page: either the bundle was not found at `HERMES_WEB_DIST`, or `HERMES_SERVE_HEADLESS=1` is set (which disables the SPA on purpose).
