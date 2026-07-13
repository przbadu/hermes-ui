# AGENTS.md

Runbook for an AI agent (Hermes, Claude Code, and similar) to set up and run `hermes-ui`.
Follow the steps in order.
This uses the manual path only: build the bundle and serve it from the gateway.
For the full human-facing reference, see [README.md](README.md).

## What you are setting up

`hermes-ui` is a browser UI for a running Hermes gateway.
It has no backend of its own.
The gateway serves the built bundle, so the UI, REST, auth, and the WebSocket all share the gateway's origin.

## The one hard rule

The UI MUST be served same-origin with the gateway.
The gateway rejects cross-origin browsers: CORS is locked to localhost, session cookies are `SameSite=Lax`, and the WebSocket closes foreign origins with close code `4403`.
Serving the bundle from the gateway (the steps below) satisfies this automatically.
Do not host the bundle on a different origin and point it at the gateway; OAuth sign-in and the WebSocket will fail.

## Preflight

Run these checks before changing anything.

1. `bun --version` verifies the package manager and script runner. If it is missing, install it from https://bun.sh and stop if it cannot be installed.
2. `command -v hermes` verifies the Hermes CLI that runs the gateway. If it is missing, the gateway is not installed here; ask the human where the gateway runs.
3. `curl -sf http://127.0.0.1:9119/api/status` confirms a gateway is reachable. Note its host and port. You will serve the UI from the gateway itself, so it must be one you can start or restart.

## Build

From the repo root:

```sh
cd app
bun install
bun run build
```

This produces `app/dist/` containing `index.html` and an `assets/` subdirectory.
The build is a single large bundle, so expect it to take a few seconds and be tens of MB.

## Serve (manual)

Serve the built bundle FROM the gateway so everything is same-origin.
Prefer the ready-made runner, from the repo root:

```sh
./bin/prod                               # builds if needed, then serves from the gateway
./bin/prod --host 0.0.0.0 --port 9119    # extra args pass straight through to 'hermes serve'
```

`bin/prod` installs dependencies, builds, and hands off to `scripts/serve-on-gateway.sh`, which exports the absolute `HERMES_WEB_DIST` and execs `hermes serve`.
If a gateway already occupies the target port, stop it first or choose another port, because two gateways cannot share a port.

Open the gateway's URL (default `http://127.0.0.1:9119`).
Sign-in (token or OAuth) works because the page and the gateway are the same origin.

### Development variant

For hot-reload development instead of a production serve:

```sh
./bin/dev                                # Vite dev server on http://127.0.0.1:5174, proxied to the gateway
HERMES_GATEWAY_URL=http://host:port ./bin/dev
```

The browser only ever talks to the Vite origin.
Vite proxies `/api`, `/auth`, and `/login` (including the WebSocket upgrade) to the gateway, which preserves the same-origin property.

## Verify

1. The gateway's URL returns the hermes-ui page, not a 404 JSON body.
2. Assets load from `/assets/...` and the page is not blank.
3. In the app, Settings -> Gateway shows the connection, and token or OAuth sign-in completes and stays in the app rather than redirecting to a foreign dashboard.
4. The WebSocket connects (the chat UI is live) with no `4403` close in the gateway logs.

## Rebuild after UI changes

```sh
cd app && bun run build
```

Then restart however you are serving: re-run `./bin/prod`, or restart the gateway process that has `HERMES_WEB_DIST` set.

## Capacitor / Android

This runbook covers the web build served same-origin from the gateway.
The native Android wrapper is a separate path: it ships bundled assets and talks to a REMOTE cross-origin gateway (chosen in-app), because `CapacitorHttp` and the native WebView origin escape the same-origin rules above.
For the native build, sync, and run steps - and the on-hardware validation risks - see [CAPACITOR.md](CAPACITOR.md).

## Guardrails

- `HERMES_WEB_DIST` must be an absolute path to `app/dist`. `scripts/serve-on-gateway.sh` handles this for you; do not hand-set a relative path.
- Do not set `HERMES_SERVE_HEADLESS=1` when hosting the UI, because it disables SPA serving on purpose.
- Do not introduce a cross-origin setup. Keep the UI same-origin with the gateway.
- This runbook covers the manual path only. Do not install or modify systemd (or any other) services unless the human explicitly asks.
