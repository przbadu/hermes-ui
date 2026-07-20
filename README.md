<a id="readme-top"></a>

<!--
*** Thanks for checking out hermes-ui. Structure inspired by the Best-README-Template.
*** https://github.com/othneildrew/Best-README-Template
-->

<!-- PROJECT SHIELDS -->
[![MIT License][license-shield]][license-url]
[![Stargazers][stars-shield]][stars-url]
[![Forks][forks-shield]][forks-url]
[![Issues][issues-shield]][issues-url]
[![React][react-shield]][react-url]
[![TypeScript][ts-shield]][ts-url]
[![Vite][vite-shield]][vite-url]

<!-- PROJECT HEADER -->
<div align="center">
  <h1 align="center">Hermes UI</h1>

  <p align="center">
    A thin, cross-platform browser UI for the Hermes gateway - the official Hermes desktop renderer, repackaged as a plain Vite web app.
    <br />
    <br />
    <a href="#demo">View Demo</a>
    &middot;
    <a href="https://github.com/przbadu/hermes-ui/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/przbadu/hermes-ui/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#demo">Demo</a></li>
        <li><a href="#built-with">Built With</a></li>
        <li><a href="#repository-layout">Repository Layout</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#quick-start">Quick Start</a></li>
        <li><a href="#automated-setup-for-ai-agents">Automated Setup (for AI agents)</a></li>
      </ul>
    </li>
    <li>
      <a href="#running-in-production">Running in Production</a>
      <ul>
        <li><a href="#a-gateway-hosted-recommended">A. Gateway-hosted (recommended)</a></li>
        <li><a href="#b-dev-with-the-vite-proxy">B. Dev with the Vite proxy</a></li>
        <li><a href="#c-reverse-proxy">C. Reverse proxy</a></li>
      </ul>
    </li>
    <li>
      <a href="#configuration">Configuration</a>
      <ul>
        <li><a href="#choosing-the-gateway-from-inside-the-app">Choosing the gateway</a></li>
        <li><a href="#whitelisting-gateways-in-configjson">Whitelisting gateways</a></li>
      </ul>
    </li>
    <li>
      <a href="#the-same-origin-model">The Same-Origin Model</a>
      <ul>
        <li><a href="#why-same-origin-is-mandatory">Why same-origin is mandatory</a></li>
        <li><a href="#exception-loopback-gateways">Exception: loopback gateways</a></li>
        <li><a href="#how-the-gateway-hosts-the-bundle">How the gateway hosts the bundle</a></li>
      </ul>
    </li>
    <li><a href="#troubleshooting">Troubleshooting</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

`hermes-ui` is a thin browser UI wrapper over the [Hermes](https://github.com/NousResearch) gateway.
It is the official Hermes desktop renderer, extracted from the `hermes-agent` monorepo and repackaged as a plain Vite web app, so the same UI can be served from a browser instead of Electron.

It ships **no backend of its own**: every request - REST, auth, and the WebSocket - goes to a running Hermes gateway.
This keeps the app tiny, portable, and easy to serve from the gateway itself, from a dev proxy, or from any reverse proxy you already run.

**Highlights**

- Runs in any modern browser, with a PWA layer for install-to-home-screen.
- Zero-config same-origin serving when hosted directly from the gateway.
- Runtime gateway switching - save personal and company gateways and switch between them, all in the browser.
- Token and OAuth authentication support.

For the extraction plan and provenance, see:

- [PLAN.md](PLAN.md) - the plan behind this repo.
- [UPSTREAM.md](UPSTREAM.md) - upstream commit, what was changed, and how to re-sync.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Demo

A short walkthrough of the UI running against a Hermes gateway - login, chat, the model picker, themes, and settings.

https://github.com/user-attachments/assets/9d45bc37-b77a-4278-91cd-3c91af837689

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

[![React][react-shield]][react-url]
[![TypeScript][ts-shield]][ts-url]
[![Vite][vite-shield]][vite-url]
[![Tailwind CSS][tailwind-shield]][tailwind-url]
[![Bun][bun-shield]][bun-url]

- **[React 19](https://react.dev)** + **[TypeScript](https://www.typescriptlang.org)** - the UI layer.
- **[Vite](https://vite.dev)** - build tooling and dev server, with `vite-plugin-pwa` for the PWA layer.
- **[Tailwind CSS 4](https://tailwindcss.com)** - styling.
- **[TanStack Query](https://tanstack.com/query)** - server-state and caching.
- **[assistant-ui](https://www.assistant-ui.com)** - chat and streaming primitives.
- **[xterm.js](https://xtermjs.org)** - the in-app terminal.
- **[Bun](https://bun.sh)** - package manager and script runner.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Repository Layout

| Path | Description |
| --- | --- |
| `app/` | The Vite web app (React + TypeScript). Builds to `app/dist/`. |
| `shared/` | Shared TypeScript sources consumed by `app/` via the `@hermes/shared` alias. |
| `bin/dev`, `bin/prod` | Zero-setup runners (install, build, and start in one command). |
| `scripts/serve-on-gateway.sh` | Helper that points a gateway at the built `app/dist/` and starts it. |
| `UPSTREAM.md`, `LICENSE` | Provenance and license (MIT, Copyright (c) 2025 Nous Research). |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

- [bun](https://bun.sh) as the package manager and script runner.
- A running Hermes gateway (`hermes serve` or `hermes dashboard`, FastAPI, default port `9119`).

The gateway is meant to run on loopback (`127.0.0.1`, the default).
Run the UI and the gateway on the same machine and reach it at `127.0.0.1`.

### Quick Start

Two runners install dependencies and start the app with no manual setup.

```sh
git clone https://github.com/przbadu/hermes-ui.git
cd hermes-ui

./bin/dev    # dev server with hot reload; open http://127.0.0.1:5174
./bin/prod   # build, then serve the bundle from the gateway (same-origin)
```

- `bin/dev` proxies to `http://127.0.0.1:9119` by default; override with `HERMES_GATEWAY_URL=http://host:port ./bin/dev`.
- `bin/prod` passes any extra arguments through to `hermes serve`, for example `./bin/prod --port 9200`.

> [!TIP]
> For gateways using OAuth, prefer `bin/prod`: the login redirect must return to the same origin the app was served from, which the gateway-hosted path guarantees.

### Automated Setup (for AI agents)

If you are an AI agent (Hermes, Claude Code, and similar), or you are asking one to set this up, follow [AGENTS.md](AGENTS.md).
It is a step-by-step runbook covering preflight checks, build, serving the bundle from the gateway (the manual path), verification, and rebuild.

The short version, from the repo root:

```sh
cd app && bun install && bun run build   # build the static bundle
cd .. && ./bin/prod                       # serve it from the gateway (same-origin)
```

The runbook deliberately covers only the manual path; an agent should not install or modify systemd services unless you explicitly ask.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- RUNNING IN PRODUCTION -->
## Running in Production

There are three ways to run the UI. All of them preserve the same-origin property the gateway requires (see [The Same-Origin Model](#the-same-origin-model)).

### A. Gateway-hosted (recommended)

Build the bundle, then start the gateway with `HERMES_WEB_DIST` pointing at the absolute path of `app/dist`.

```sh
cd app
bun install
bun run build
```

Then start the gateway with the built bundle:

```sh
HERMES_WEB_DIST="$(pwd)/dist" hermes serve
```

Or use the helper, which resolves the absolute path and exports the variable for you:

```sh
./scripts/serve-on-gateway.sh
```

Open the gateway's URL (default `http://127.0.0.1:9119`).
Because the UI is served by the gateway, everything is same-origin: cookies, CORS, and the WebSocket all work, and the gateway injects the session token into `index.html` automatically.

> [!IMPORTANT]
> `HERMES_WEB_DIST` must be an absolute path.

### B. Dev with the Vite proxy

For local development with hot reload, run the Vite dev server.
The browser only ever talks to the Vite origin (`http://127.0.0.1:5174`); Vite proxies `/api`, `/auth`, and `/login` (including the WebSocket upgrade) to the gateway, keeping the browser same-origin with the dev server.

```sh
cd app
bun install
bun run dev
```

The proxy targets `http://127.0.0.1:9119` by default.
If the gateway runs on a different host or port, set `HERMES_GATEWAY_URL` before starting the dev server:

```sh
HERMES_GATEWAY_URL=http://127.0.0.1:9200 bun run dev
```

`HERMES_GATEWAY_URL` picks the single gateway the browser talks to same-origin through the proxy.
To whitelist additional gateways you can add by hand in Settings, list them in a repo-root `config.json` (see [Whitelisting gateways](#whitelisting-gateways-in-configjson)).

### C. Reverse proxy

If you want to serve the UI from your own web server, host the contents of `app/dist/` as static files and proxy `/api`, `/auth`, and `/login` (with WebSocket upgrade support on `/api`) to the gateway, all under one domain.
Serving the static files and proxying the API paths on the same origin preserves the same-origin property the gateway requires.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONFIGURATION -->
## Configuration

### Choosing the gateway from inside the app

The connection is editable at runtime in **Settings -> Gateway**, exactly like the desktop app.
It defaults to the origin the app was served from, so the gateway-hosted and dev-proxy paths need no configuration.

You can point it at another gateway URL (an absolute `https://host` or a `/prefix` path on the serving origin) and choose token or OAuth authentication; the choice is saved in the browser.
You can save multiple gateways (personal, company, and so on) and switch between them; the list lives in the browser.

The same-origin constraint below still applies to whatever URL you enter.

### Whitelisting gateways in `config.json`

`HERMES_GATEWAY_URL` picks the default gateway the dev server proxies same-origin.
To make additional gateways behave the same way - proxied same-origin so both token and OAuth work - copy `config.example.json` to `config.json` in the repo root and list their URLs:

```json
{
  "gateways": [
    "http://203.0.113.10:9119",
    "https://hermes.example.com"
  ]
}
```

`config.json` is git-ignored, so it never leaks your gateway URLs into version control.
You can also pass them by env: `HERMES_GATEWAY_WHITELIST=url1,url2 bin/dev`.

The dev server merges these with `HERMES_GATEWAY_URL` into a whitelist and hands it to the app.
Each whitelisted gateway is then folded to the serving origin: the dev proxy routes every request (and the WebSocket) to whichever gateway is currently active, chosen per-request from a validated marker, so only whitelisted origins are ever reachable (not an open proxy).
Because it is proxied same-origin, adding a whitelisted gateway in Settings connects exactly like the default - OAuth sign-in and cookie sessions included.

This does **not** add anything to your saved gateway list - you still add each gateway yourself in Settings; the whitelist only decides which ones the dev proxy will carry.
It is a dev-time mechanism: `bin/dev` (Vite) injects the whitelist, and the gateway-hosted production path does not read `config.json`.
Loopback gateways (`localhost` / `127.0.0.1`) are always allowed and never need a `config.json` entry.

Two caveats worth knowing:

- **OAuth needs the gateway to trust the dev origin.** Because the proxy preserves the dev Host, the gateway builds its OAuth `redirect_uri` as `http://127.0.0.1:5174/auth/callback`. Sign-in only completes if that gateway's OAuth provider trusts `http://127.0.0.1:5174` as a redirect URI (the local default gateway, and self-hosted gateways you can configure, do; a hosted gateway with only its own https callback registered will fail at `/login` with `redirect_uri_mismatch`). For a gateway that does not trust the dev origin, use a **session token** instead.
- **Reach a remote gateway over its http origin/IP, not an https domain.** Proxying to an `https://` gateway domain (especially one fronted by a CDN) can fail the Node-side TLS handshake (`SSL alert number 40`). Listing the gateway's `http://host:port` origin avoids this and is the recommended form for a self-hosted gateway.

Each gateway's session cookie is namespaced per target inside the dev cookie jar, so switching gateways never leaks one gateway's session to another, and switching back keeps the prior session.

> [!NOTE]
> Known limitation: two browser tabs pointed at two different active gateways is unsupported in dev (the active gateway lives in shared browser storage); use one gateway per browser profile if you need two at once.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- SAME-ORIGIN MODEL -->
## The Same-Origin Model

### Why same-origin is mandatory

The gateway is locked down to same-origin browsers and cannot be talked to cross-origin:

- CORS is hardcoded to localhost origins, so a browser served from any other origin is rejected.
- Session cookies are `SameSite=Lax`, so they are not sent on cross-site requests.
- The WebSocket rejects foreign origins and closes the connection with close code `4403`.

Serving the built bundle from the gateway itself (option A) makes the UI, REST, auth, and WebSocket all share one origin, so cookies, CORS, and the WebSocket all work with no extra configuration.
The dev proxy (option B) and a reverse proxy (option C) are the two ways to preserve that same-origin property without hosting on the gateway directly.

### Exception: loopback gateways

When the app itself is served from loopback (`localhost` or `127.0.0.1`), it can reach any other loopback gateway directly, even on a different port, with no proxy.
Those origins are same-site (only the port differs), and everything the browser needs already lines up: the gateway's CORS allows localhost origins, and the app sends its credentials in an `X-Hermes-Session-Token` header for REST and a `?token=` query param for the WebSocket, so no cookie ever has to cross origins.
This is why a localhost gateway just works once you add it in **Settings -> Gateway**, and why it does not need a `config.json` entry to be reachable.

OAuth cookie sessions are the one thing that still cannot cross origins directly: the gateway sends no `Access-Control-Allow-Credentials`, so its `SameSite=Lax` session cookie is never accepted cross-origin.
For a cross-port loopback gateway you want to sign into with OAuth, whitelist it (see [Whitelisting gateways](#whitelisting-gateways-in-configjson)) so the dev proxy folds it same-origin, or use a **session token**.
The blanket same-origin requirement above still holds for every non-loopback origin that is not whitelisted through the dev proxy.

### How the gateway hosts the bundle

The gateway's `mount_spa()` serves a static directory selected by the `HERMES_WEB_DIST` environment variable:

- The directory is read from `HERMES_WEB_DIST` and falls back to a bundled `web_dist` when the variable is unset.
- The bundle's `assets` subdirectory is mounted at `/assets`, so the gateway expects `<HERMES_WEB_DIST>/assets` to exist.
- All other paths fall back to `<HERMES_WEB_DIST>/index.html` for SPA client-side routing.
- Before serving `index.html`, the gateway injects the session token as `window.__HERMES_SESSION_TOKEN__` in a `<script>` tag placed just before `</head>`, so the SPA can authenticate against protected endpoints in loopback/token mode.

> [!NOTE]
> `hermes serve` respects `HERMES_SERVE_HEADLESS=1` and will refuse to serve the SPA when it is set; leave it unset to host the UI.

The Vite build uses `base: './'` (`app/vite.config.ts`), so asset URLs in the built `index.html` are relative (for example `./assets/index-*.js`), which resolves correctly when the bundle is served at the domain root.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- TROUBLESHOOTING -->
## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Blank page or 404 on assets | `HERMES_WEB_DIST` is wrong or not absolute. It must be the absolute path to `app/dist`, and that directory must contain both `index.html` and an `assets/` subdirectory. |
| WebSocket closes with code `4403` | The app is not same-origin with the gateway. Serve it via option A, B, or C so the browser origin matches the gateway. |
| Cross-origin fetch failures (CORS errors, missing cookies) | Same root cause as the `4403` case - the UI is served from an origin the gateway does not trust. Make it same-origin. |
| `hermes serve` returns 404 JSON for every page | Either the bundle was not found at `HERMES_WEB_DIST`, or `HERMES_SERVE_HEADLESS=1` is set (which disables the SPA on purpose). |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

Milestones tracked in [PLAN.md](PLAN.md):

- [x] **M0** - Foundation: extraction and the web bridge.
- [x] **M1** - Boot and auth verification against a real gateway.
- [x] **M2** - PWA layer.
- [ ] **M3** - Feature gating and web polish.
- [ ] **M4** - Mobile layout pass.
- [ ] **M5** - Capacitor / Android.
- [ ] **M6** - Store release and optional desktop wrap.

See the [open issues](https://github.com/przbadu/hermes-ui/issues) for a full list of proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create.
Any contributions you make are **greatly appreciated**.

1. Fork the project.
2. Create your feature branch (`git checkout -b feat/amazing-feature`).
3. Run the checks in `app/`: `bun run typecheck`, `bun run lint`, and `bun run test:ui`.
4. Commit your changes (`git commit -m 'feat: add amazing feature'`).
5. Push to the branch (`git push origin feat/amazing-feature`).
6. Open a pull request.

Keep local modifications minimal and centralized in `app/src/web-bridge/` so upstream diffs stay clean (see [UPSTREAM.md](UPSTREAM.md)).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
Copyright (c) 2025 Nous Research.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

- [Nous Research](https://nousresearch.com) - authors of the Hermes Agent and the original desktop renderer this app is extracted from.
- [Best-README-Template](https://github.com/othneildrew/Best-README-Template) - the structure this README follows.
- [Shields.io](https://shields.io) - the badges above.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[license-shield]: https://img.shields.io/github/license/przbadu/hermes-ui.svg?style=for-the-badge
[license-url]: https://github.com/przbadu/hermes-ui/blob/main/LICENSE
[stars-shield]: https://img.shields.io/github/stars/przbadu/hermes-ui.svg?style=for-the-badge
[stars-url]: https://github.com/przbadu/hermes-ui/stargazers
[forks-shield]: https://img.shields.io/github/forks/przbadu/hermes-ui.svg?style=for-the-badge
[forks-url]: https://github.com/przbadu/hermes-ui/network/members
[issues-shield]: https://img.shields.io/github/issues/przbadu/hermes-ui.svg?style=for-the-badge
[issues-url]: https://github.com/przbadu/hermes-ui/issues
[react-shield]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[react-url]: https://react.dev
[ts-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org
[vite-shield]: https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white
[vite-url]: https://vite.dev
[tailwind-shield]: https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white
[tailwind-url]: https://tailwindcss.com
[bun-shield]: https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white
[bun-url]: https://bun.sh
