import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'

// Dev-time gateway target. The browser only ever talks to the Vite origin;
// REST, auth, and the WebSocket upgrade are proxied so cookies stay
// same-origin (the gateway's CORS and WS Origin checks are localhost-only).
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

// Origins the client should treat as reachable: the proxy target plus every
// config.json gateway, deduped by origin. Non-absolute or unparseable entries
// are dropped (a bare `/prefix` is same-origin and needs no whitelisting).
function whitelistOrigins(urls: string[]): string[] {
  const origins = new Set<string>()

  for (const url of urls) {
    try {
      origins.add(new URL(url).origin)
    } catch {
      // skip non-absolute / unparseable entries
    }
  }

  return [...origins]
}

const LOCAL_CONFIG = readLocalConfig()
const GATEWAY_WHITELIST = whitelistOrigins([GATEWAY, ...configGatewayUrls(LOCAL_CONFIG)])

export default defineConfig({
  base: './',
  plugins: [
    // Dev only: tell the client which gateway origin the proxy below forwards
    // to, so an absolute gateway URL pointing at it can be routed back through
    // the same-origin proxy (see normalizeBase). Mirrors how the gateway injects
    // window.__HERMES_BASE_PATH__ / __HERMES_SESSION_TOKEN__ into the served HTML.
    // `apply: 'serve'` keeps it out of production builds, where no proxy exists.
    {
      name: 'hermes-dev-proxy-target',
      apply: 'serve',
      transformIndexHtml: () => {
        // Escape `<` so a value containing `</script>` can't break out of the
        // inline script. Dev-only and developer-supplied, but cheap to harden.
        const inject = (value: unknown) => JSON.stringify(value ?? null).replace(/</g, '\\u003c')

        return [
          {
            tag: 'script',
            injectTo: 'head-prepend',
            children:
              `window.__HERMES_DEV_PROXY_TARGET__ = ${inject(GATEWAY)};` +
              `window.__HERMES_GATEWAY_WHITELIST__ = ${inject(GATEWAY_WHITELIST)};`
          }
        ]
      }
    },
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
        globPatterns: ['**/*.{js,css,html,woff,woff2,ttf,otf,eot,png,jpg,jpeg,svg,gif,webp,ico}'],
        // This app ships as one large single-chunk bundle (code splitting is
        // disabled in build.rolldownOptions), so the shell JS is ~28 MB. Raise
        // the precache size cap above it, otherwise the core bundle is skipped
        // and the app is not offline-capable.
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
    // Shiki ships many dynamic chunks by default; keep the single-chunk
    // upstream behavior so the gateway's static host serves one bundle.
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        codeSplitting: false
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
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: GATEWAY, changeOrigin: false, ws: true },
      '/auth': { target: GATEWAY, changeOrigin: false },
      '/login': { target: GATEWAY, changeOrigin: false }
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4174
  }
})
