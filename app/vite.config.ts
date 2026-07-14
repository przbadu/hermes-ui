import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { createProxyServer, type ProxyServer } from 'http-proxy-3'
import crypto from 'node:crypto'
import fs from 'fs'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

// Primary dev-time gateway - the default proxy target when no other whitelisted
// gateway is active. The browser only ever talks to the Vite origin; /api,
// /auth, /login and the /api/ws upgrade are proxied so cookies stay same-origin
// (the gateway's CORS and WS Origin checks are localhost-only).
const GATEWAY = process.env.HERMES_GATEWAY_URL ?? 'http://127.0.0.1:9119'

// Optional local config file (repo root config.json, git-ignored - see
// config.example.json). A general-purpose bag for developer-local settings;
// today its `gateways` array whitelists additional gateway URLs so they can be
// added by hand in Settings without the browser pre-blocking them as
// cross-origin. Read once at config load; parse failures degrade to no config
// rather than breaking the dev server.
function readLocalConfig(): { gateways?: unknown } | null {
  const file = path.resolve(__dirname, '..', 'config.json')

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[hermes] ignoring unreadable config.json: ${(error as Error).message}`)
    }

    return null
  }
}

// A config.json `gateways` entry is either a bare URL string or an object with a
// `url` field, so the same file can carry extra metadata later without breaking.
function configGatewayUrls(config: { gateways?: unknown } | null): string[] {
  const raw = config?.gateways

  if (!Array.isArray(raw)) {return []}

  return raw
    .map(entry => (typeof entry === 'string' ? entry : (entry as { url?: unknown })?.url))
    .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
    .map(url => url.trim())
}

// An optional comma-separated env whitelist, equivalent to config.json gateways
// (so `HERMES_GATEWAY_WHITELIST=url1,url2 bin/dev` works too).
function envGatewayUrls(): string[] {
  return (process.env.HERMES_GATEWAY_WHITELIST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

const LOCAL_CONFIG = readLocalConfig()

// origin -> full URL, so a path-prefixed gateway keeps its prefix (mirrors the
// old static `target: GATEWAY` prependPath behavior). First writer wins, so the
// primary HERMES_GATEWAY_URL takes precedence for its own origin.
const TARGETS = new Map<string, string>()

for (const url of [GATEWAY, ...configGatewayUrls(LOCAL_CONFIG), ...envGatewayUrls()]) {
  try {
    const origin = new URL(url).origin

    if (!TARGETS.has(origin)) {TARGETS.set(origin, url)}
  } catch {
    // skip non-absolute / unparseable entries (a bare `/prefix` is same-origin)
  }
}

// Origins the client may fold through the dev proxy (treated as same-origin).
const GATEWAY_WHITELIST = [...TARGETS.keys()]

// A malformed HERMES_GATEWAY_URL must degrade, not crash config load.
const DEFAULT_TARGET = (() => {
  try {
    new URL(GATEWAY)

    return GATEWAY
  } catch {
    return 'http://127.0.0.1:9119'
  }
})()

// --- Dynamic dev proxy ------------------------------------------------------
// /api, /auth, /login (and the /api/ws upgrade) are forwarded to whichever
// whitelisted gateway is active, chosen PER REQUEST from a validated `__hgw`
// query param (fetch/WS) or the `hermes_dev_gateway` cookie (OAuth callback
// navigations, which carry no param). Only whitelisted origins are ever
// reachable, so this is not an open proxy. Each upstream's cookies are
// namespaced per target, so one gateway's session never reaches another.
const PROXY_PREFIXES = ['/api', '/auth', '/login']
const ROUTE_COOKIE = 'hermes_dev_gateway'
const ROUTE_PARAM = '__hgw'
const TARGET_ORIGIN = Symbol('hermesTargetOrigin')

function matchesPrefix(url: string | undefined): boolean {
  if (!url) {return false}

  return PROXY_PREFIXES.some(p => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`))
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {return undefined}

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')

    if (eq === -1) {continue}

    if (part.slice(0, eq).trim() === name) {return decodeURIComponent(part.slice(eq + 1).trim())}
  }

  return undefined
}

// Return the origin only if it is whitelisted; otherwise undefined. This is the
// SSRF guard - a forged param/cookie can never route to an off-whitelist host.
function validOrigin(raw: null | string | undefined): string | undefined {
  if (!raw) {return undefined}

  try {
    const origin = new URL(raw).origin

    return TARGETS.has(origin) ? origin : undefined
  } catch {
    return undefined
  }
}

// __hgw param, then selector cookie, then the default - each whitelist-checked.
function resolveOrigin(req: IncomingMessage): string {
  const parsed = req.url ? new URL(req.url, 'http://x') : null

  return (
    validOrigin(parsed?.searchParams.get(ROUTE_PARAM)) ??
    validOrigin(readCookie(req.headers.cookie, ROUTE_COOKIE)) ??
    new URL(DEFAULT_TARGET).origin
  )
}

function targetTag(origin: string): string {
  return crypto.createHash('sha256').update(origin).digest('hex').slice(0, 8)
}

// Forward only THIS target's cookies (namespace-stripped); never the selector
// or another target's session cookie -> no cross-gateway credential leak.
function rewriteCookieHeader(header: string | undefined, tag: string): string | undefined {
  if (!header) {return undefined}

  const suffix = `__hg_${tag}`
  const kept: string[] = []

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')

    if (eq === -1) {continue}
    const name = part.slice(0, eq).trim()

    if (name === ROUTE_COOKIE) {continue}

    if (name.endsWith(suffix)) {kept.push(`${name.slice(0, -suffix.length)}=${part.slice(eq + 1).trim()}`)}
  }

  return kept.length ? kept.join('; ') : undefined
}

// Namespace the upstream's Set-Cookie per target and force host-only (drop
// Domain) so it binds to the dev origin. Secure is left intact and simply won't
// survive an http dev origin (documented; remote-https OAuth is unsupported).
function namespaceSetCookie(cookie: string, tag: string): string {
  const segments = cookie.split(';')
  const first = segments[0]
  const eq = first.indexOf('=')

  if (eq === -1) {return cookie}
  const name = first.slice(0, eq).trim()
  const value = first.slice(eq + 1)
  const attrs = segments.slice(1).filter(s => !/^\s*domain=/i.test(s))

  return [`${name}__hg_${tag}=${value}`, ...attrs].join(';')
}

function stripRouteParam(req: IncomingMessage): void {
  if (!req.url || !req.url.includes(ROUTE_PARAM)) {return}
  const u = new URL(req.url, 'http://x')
  u.searchParams.delete(ROUTE_PARAM)
  req.url = u.pathname + u.search
}

// `apply: 'serve'` keeps this out of production builds, where the gateway serves
// the bundle same-origin and no proxy exists.
function hermesDynamicProxy(): Plugin {
  return {
    name: 'hermes-dev-dynamic-proxy',
    apply: 'serve',
    transformIndexHtml: () => {
      // Escape `<` so a value containing `</script>` can't break out of the
      // inline script. Dev-only and developer-supplied, but cheap to harden.
      const inject = (value: unknown) => JSON.stringify(value ?? null).replace(/</g, '\\u003c')

      return [
        {
          tag: 'script',
          injectTo: 'head-prepend',
          children: `window.__HERMES_GATEWAY_WHITELIST__ = ${inject(GATEWAY_WHITELIST)};`
        }
      ]
    },
    configureServer(server) {
      // changeOrigin stays false so the gateway sees Host/Origin = the dev
      // origin and builds same-origin redirect URIs / accepts the WS. `secure:
      // false` tolerates a self-signed cert on a whitelisted https gateway.
      const proxy: ProxyServer = createProxyServer({ changeOrigin: false, secure: false, ws: true })

      proxy.on('proxyRes', (proxyRes, req) => {
        const setCookie = proxyRes.headers['set-cookie']

        if (!setCookie) {return}
        const origin = (req as unknown as Record<symbol, string>)[TARGET_ORIGIN]

        if (!origin) {return}
        const tag = targetTag(origin)
        proxyRes.headers['set-cookie'] = setCookie.map(c => namespaceSetCookie(c, tag))
      })

      proxy.on('error', (err, _req, resOrSocket) => {
        server.config.logger.error(`[hermes-proxy] ${err.message}`, { timestamp: true })

        if (resOrSocket && 'writeHead' in resOrSocket) {
          const res = resOrSocket as ServerResponse

          if (!res.headersSent) {res.writeHead(502, { 'content-type': 'text/plain' })}
          res.end('gateway proxy error')
        } else if (resOrSocket) {
          // A failed WS upgrade: fully tear the socket down, don't half-close.
          ;(resOrSocket as Socket).destroy()
        }
      })

      // Resolve the upstream, rewrite the forwarded Cookie to that target's
      // namespace, strip our routing param, and stash the origin for proxyRes.
      const route = (req: IncomingMessage): string => {
        const origin = resolveOrigin(req)
        const cookie = rewriteCookieHeader(req.headers.cookie, targetTag(origin))

        // Assigning `undefined` makes Node throw on setHeader('cookie'); delete
        // the header instead when this target has no cookies to forward.
        if (cookie === undefined) {
          delete req.headers.cookie
        } else {
          req.headers.cookie = cookie
        }
        stripRouteParam(req)
        ;(req as unknown as Record<symbol, string>)[TARGET_ORIGIN] = origin

        return TARGETS.get(origin) ?? DEFAULT_TARGET
      }

      // HTTP: registering in the body runs this before Vite's spa-fallback.
      server.middlewares.use((req, res, next) => {
        if (!matchesPrefix(req.url)) {return next()}
        proxy.web(req, res, { target: route(req) })
      })

      // WS: claim ONLY /api (the gateway WS is /api/ws); leave vite-hmr to Vite.
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url || !req.url.startsWith('/api')) {return}
        proxy.ws(req, socket, head, { target: route(req) })
      })
    }
  }
}

export default defineConfig({
  base: './',
  // Per-build id, read by the React Query persistence layer as a cache buster so
  // a redeploy (or dev restart) drops any persisted query blob whose data shape
  // may have changed. Computed once at config load.
  define: {
    __HERMES_BUILD_ID__: JSON.stringify(String(Date.now()))
  },
  plugins: [
    // Dev only: the dynamic gateway proxy + injection of
    // window.__HERMES_GATEWAY_WHITELIST__ so the client knows which absolute
    // gateway origins fold through the same-origin proxy (see normalizeBase).
    hermesDynamicProxy(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the SW ourselves from src/pwa/register.ts.
      injectRegister: null,
      manifest: {
        name: 'Hermes',
        short_name: 'Hermes',
        description: 'A UI for the Hermes agent.',
        display: 'standalone',
        // Hash-routed SPA served at the domain root: start at the root so the
        // shell boots and react-router takes over from the #/ fragment.
        start_url: '.',
        scope: '.',
        background_color: '#111111',
        theme_color: '#0a0a0a',
        icons: [
          { src: 'hermes.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'hermes.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'hermes.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Precache the built app shell. Workbox rewrites the manifest with the
        // content-hashed filenames Vite emits, so nothing is hardcoded here.
        // The `**/*.js` glob matches every emitted chunk (entry + the async
        // vendor chunks split out in build.rolldownOptions), so the whole app
        // - including lazily-loaded routes - stays precached and offline-ready.
        globPatterns: ['**/*.{js,css,html,woff,woff2,ttf,otf,eot,png,jpg,jpeg,svg,gif,webp,ico}'],
        // Code splitting is enabled (build.rolldownOptions), so the bundle is
        // now many smaller hashed chunks rather than one ~28 MB file; the
        // per-file cap is no longer the binding constraint. Kept generous so
        // even the largest split vendor chunk is always precached - a chunk
        // over the cap would be silently skipped and break offline use.
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        // Serve index.html for real navigations so deep hash routes and hard
        // refreshes work offline...
        navigateFallback: 'index.html',
        // ...but NEVER hijack the gateway: /api (REST + the /api/ws upgrade),
        // /auth, and /login must always hit the network, not the SW cache.
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/login/]
        // No runtimeCaching: there are no rules that could match /api, so the
        // SW never caches or intercepts backend traffic.
      },
      devOptions: {
        // Keep the SW off in dev so it can't shadow the Vite /api proxy or
        // serve stale assets while iterating.
        enabled: false
      }
    })
  ],
  css: {
    // Pin an explicit (empty) PostCSS config so an unrelated postcss/tailwind
    // config higher up the tree can never leak into this build. Tailwind is
    // handled entirely by `@tailwindcss/vite`.
    postcss: { plugins: [] }
  },
  build: {
    // Split chunks are content-hashed and served under ./assets from one
    // origin (base: './'), so a multi-chunk bundle is served fine by the
    // gateway's static host. This warns only if a single chunk is still huge.
    chunkSizeWarningLimit: 4000,
    rolldownOptions: {
      // Rolldown (rolldown-vite) drives the build, so chunking config lives
      // here rather than under rollupOptions. `codeSplitting` accepts a boolean
      // or a CodeSplittingOptions object; the object form both ENABLES splitting
      // and declares advanced chunk groups (rolldown's replacement for rollup's
      // manualChunks - see rolldown's CodeSplittingOptions type).
      //
      // Enabling splitting is the whole point: it lets the lazy() route
      // boundaries in desktop-controller and the libraries' own dynamic imports
      // (shiki loads each language on demand, mermaid each diagram type) pay off.
      // Those were inlined into one ~27 MB chunk while splitting was off. With
      // it on, the boot-critical static-import closure drops to ~4 MB and the
      // parse-costly libs - mermaid, shiki, @xterm, @codemirror - fall out of it
      // into async chunks, loaded only when their feature is opened.
      //
      // We deliberately DON'T force those heavy libs into manual groups. shiki,
      // codemirror, xterm and katex are each partially reachable from the boot
      // path (the chat view highlights code at load), so collapsing all of a
      // library's modules into one named chunk promotes that entire chunk -
      // including every lazily-loadable language/diagram - back onto the boot
      // path, undoing the win (measured: ~26 MB boot-critical with such groups
      // vs ~4 MB without). rolldown's automatic splitting already keeps the
      // boot-reachable slivers separate from the async bulk, so we let it.
      //
      // The one group we do keep is react/react-dom: it is boot-critical either
      // way, so pinning it to a stable, content-addressed vendor chunk costs no
      // boot bytes and improves cross-deploy cache hits. `[\\/]` matches the
      // path separator cross-platform (rolldown's guidance).
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 10
            }
          ]
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hermes/shared': path.resolve(__dirname, '../shared/src')
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    // /api, /auth, /login (+ the /api/ws upgrade) are handled by
    // hermesDynamicProxy() above, which routes per-request to the active
    // whitelisted gateway. No static proxy here.
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4174
  }
})
