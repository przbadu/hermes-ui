/**
 * Multiple gateway connections for the web build.
 *
 * A "gateway" here is a distinct Hermes server the app can talk to (for
 * example a personal gateway on localhost and a company gateway on a remote
 * host). This is deliberately NOT the same as a Hermes "profile": profiles are
 * agent personas that live inside ONE gateway and are listed from that
 * gateway's /api/profiles. Gateways are whole servers, chosen here on the
 * client and persisted in the browser.
 *
 * Only one gateway is active at a time. Switching sets the active id and
 * reloads the app so the whole boot path re-runs against the new connection
 * (the same thing "Save and reconnect" does). This module is the single source
 * of truth; the window.hermesDesktop bridge reads the active gateway from here.
 */
import { atom } from 'nanostores'

export interface GatewayConnection {
  id: string
  name: string
  /** Absolute `https://host[:port]`, a `/prefix` on the serving origin, or '' to mean the serving origin. */
  url: string
  authMode: 'oauth' | 'token'
  token?: string
}

interface GatewayStore {
  version: 1
  activeId: string
  gateways: GatewayConnection[]
}

const STORAGE_KEY = 'hermes-ui.gateways'
// The single-connection key this feature replaced; migrated once if present.
const LEGACY_CONNECTION_KEY = 'hermes-web.connection'

const DEFAULT_ID = 'default'

function resolveBasePath(): string {
  const raw = window.__HERMES_BASE_PATH__ ?? ''

  return raw === '/' ? '' : raw.replace(/\/$/, '')
}

/** The origin the app was served from - the zero-config default gateway. */
export function servingBase(): string {
  return window.location.origin + resolveBasePath()
}

/**
 * In `vite dev`, /api, /auth, /login (and the /api/ws upgrade) are proxied to
 * the active whitelisted gateway (see app/vite.config.ts) so the browser only
 * ever talks to the Vite origin and the gateway's session cookie stays
 * same-origin. Any whitelisted absolute gateway URL is therefore folded back to
 * the serving origin here, so OAuth (cookies + WS tickets) works exactly as it
 * does for the zero-config default gateway. Outside dev, or for a non-whitelisted
 * origin, the absolute URL is used verbatim.
 */
function rewriteThroughDevProxy(absoluteUrl: string): string {
  try {
    if (isDevProxyOrigin(new URL(absoluteUrl).origin)) { return servingBase() }
  } catch {
    // Unparseable url: fall through and use it verbatim.
  }

  return absoluteUrl
}

/**
 * Resolve a gateway `url` to an absolute base:
 * - `https://host[:port]` is used as-is.
 * - a `/prefix` is a reverse-proxy path on the serving origin.
 * - '' or anything else falls back to the serving origin.
 * A trailing slash is always trimmed.
 */
export function normalizeBase(url: string): string {
  const value = (url || '').trim().replace(/\/+$/, '')

  if (!value) { return servingBase() }

  if (/^https?:\/\//i.test(value)) { return rewriteThroughDevProxy(value) }

  if (value.startsWith('/')) { return window.location.origin + value }

  return servingBase()
}

/**
 * Why a gateway `url` can't be reached from THIS browser, or `null` when it can.
 *
 * A browser tab can reach:
 *   - a SAME-ORIGIN gateway: the serving origin, a `/prefix` on it, or - in dev -
 *     any WHITELISTED gateway, which `normalizeBase` folds to the serving origin
 *     because the Vite proxy forwards it there (so OAuth cookies + WS tickets
 *     work exactly like the zero-config default);
 *   - any LOOPBACK gateway when the app is itself served from loopback
 *     (localhost:5174 -> localhost:9200): same-site, only the port differs.
 * The only hard block is `mixed-content` (an https page cannot fetch an http
 * gateway at all). Anything else non-loopback and un-whitelisted is reported as
 * `cross-origin` so the UI can explain it instead of firing a doomed request.
 */
export type GatewayReachBlock = 'mixed-content' | 'cross-origin'

/** Loopback hosts, which the browser treats as one site regardless of port. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()

  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
}

/**
 * Origins the developer whitelisted as dev-proxy targets, via HERMES_GATEWAY_URL
 * + repo-root `config.json` + `HERMES_GATEWAY_WHITELIST` (injected as
 * `__HERMES_GATEWAY_WHITELIST__`; see app/vite.config.ts). Dev-only; empty in a
 * production build. Compared by URL origin, so a trailing path/slash is ignored.
 */
function isDevProxyOrigin(origin: string): boolean {
  const list = window.__HERMES_GATEWAY_WHITELIST__

  if (!Array.isArray(list)) { return false }

  return list.some(entry => {
    try {
      return new URL(entry).origin === origin
    } catch {
      return false
    }
  })
}

export function classifyGatewayReach(url: string): GatewayReachBlock | null {
  try {
    const target = new URL(normalizeBase(url), window.location.href)

    // Same-origin covers every whitelisted gateway: normalizeBase has already
    // folded it to the serving origin (proxied same-origin in dev).
    if (target.origin === window.location.origin) { return null }

    // An https page can never fetch an http gateway.
    if (window.location.protocol === 'https:' && target.protocol === 'http:') { return 'mixed-content' }

    // A loopback gateway reached from a loopback app is same-site (only the port
    // differs) - reachable with no configuration.
    if (isLoopbackHost(target.hostname) && isLoopbackHost(window.location.hostname)) { return null }

    return 'cross-origin'
  } catch {
    // Unparseable input: let the normal probe/validation surface it.
    return null
  }
}

const DEV_GATEWAY_COOKIE = 'hermes_dev_gateway'
const ROUTE_PARAM = '__hgw'

/**
 * The absolute upstream origin a gateway `url` resolves to IF it is an absolute
 * whitelisted URL, else null. The zero-config default ('') and `/prefix`
 * gateways have no distinct upstream - they ride the default proxy target.
 */
export function upstreamOriginFor(gatewayUrl: string): string | null {
  const value = (gatewayUrl || '').trim()

  if (!/^https?:\/\//i.test(value)) { return null }

  try {
    const origin = new URL(value).origin

    return isDevProxyOrigin(origin) ? origin : null
  } catch {
    return null
  }
}

/** Upstream origin of the currently active gateway, or null for the default. */
export function activeUpstreamOrigin(): string | null {
  return upstreamOriginFor(getActiveGateway().url)
}

/**
 * Stamp the target upstream onto a request URL (`?__hgw=<origin>`) so the dev
 * proxy routes it per-request, independent of shared cookie/tab state. No-op in
 * production (no whitelist) and for the default gateway (no upstream origin).
 */
export function withGatewayRoute(url: string, upstreamOrigin: string | null): string {
  if (!upstreamOrigin || !Array.isArray(window.__HERMES_GATEWAY_WHITELIST__)) { return url }
  const u = new URL(url, window.location.href)
  u.searchParams.set(ROUTE_PARAM, upstreamOrigin)

  return u.toString()
}

/**
 * Dev-only: keep the `hermes_dev_gateway` selector cookie in sync with the
 * active gateway, so an OAuth callback navigation (which carries no `__hgw`
 * param - the IDP controls the URL) still routes to the right upstream. No-op in
 * production; cleared for the default ('') and `/prefix` gateways.
 */
export function syncDevGatewayCookie(): void {
  if (!Array.isArray(window.__HERMES_GATEWAY_WHITELIST__)) { return }
  const origin = activeUpstreamOrigin()
  document.cookie = origin
    ? `${DEV_GATEWAY_COOKIE}=${encodeURIComponent(origin)}; path=/; SameSite=Lax`
    : `${DEV_GATEWAY_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // Fallback for the rare environment without crypto.randomUUID; uniqueness
    // only needs to hold within this browser's saved list.
    return `gw-${Date.now().toString(36)}`
  }
}

function defaultStore(): GatewayStore {
  return {
    version: 1,
    activeId: DEFAULT_ID,
    gateways: [{ id: DEFAULT_ID, name: 'Default', url: '', authMode: 'oauth' }]
  }
}

function migrateLegacy(): GatewayStore | null {
  try {
    const raw = localStorage.getItem(LEGACY_CONNECTION_KEY)

    if (!raw) { return null }

    const parsed = JSON.parse(raw) as {
      remoteAuthMode?: string
      remoteToken?: string
      remoteUrl?: string
    }

    const store: GatewayStore = {
      version: 1,
      activeId: DEFAULT_ID,
      gateways: [
        {
          id: DEFAULT_ID,
          name: 'Default',
          url: (parsed.remoteUrl ?? '').trim(),
          authMode: parsed.remoteAuthMode === 'token' ? 'token' : 'oauth',
          token: parsed.remoteToken ?? ''
        }
      ]
    }

    localStorage.removeItem(LEGACY_CONNECTION_KEY)

    return store
  } catch {
    return null
  }
}

function sanitize(store: Partial<GatewayStore> | null): GatewayStore {
  if (!store || !Array.isArray(store.gateways) || store.gateways.length === 0) {
    return defaultStore()
  }

  const gateways = store.gateways
    .filter(g => g && typeof g.id === 'string')
    .map(g => ({
      id: g.id,
      name: (g.name || '').trim() || 'Gateway',
      url: (g.url ?? '').trim(),
      authMode: g.authMode === 'token' ? ('token' as const) : ('oauth' as const),
      token: g.token ?? ''
    }))

  if (gateways.length === 0) { return defaultStore() }
  const activeId = gateways.some(g => g.id === store.activeId) ? (store.activeId as string) : gateways[0].id

  return { version: 1, activeId, gateways }
}

function load(): GatewayStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (raw) { return sanitize(JSON.parse(raw) as Partial<GatewayStore>) }
    const migrated = migrateLegacy()

    if (migrated) {
      save(migrated)

      return migrated
    }
  } catch {
    // fall through to default
  }

  return defaultStore()
}

function save(store: GatewayStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // best-effort; a full/blocked localStorage just means non-persisted state
  }
}

// Reactive mirrors for the UI. The bridge reads via the getters below (which
// always reflect localStorage), while React components subscribe to these.
const initial = load()
export const $gateways = atom<GatewayConnection[]>(initial.gateways)
export const $activeGatewayId = atom<string>(initial.activeId)

// Dev-only: set the routing cookie for the active gateway before the bridge
// issues its first request on this (possibly reloaded) page. No-op in prod.
syncDevGatewayCookie()

function commit(store: GatewayStore): void {
  save(store)
  $gateways.set(store.gateways)
  $activeGatewayId.set(store.activeId)
}

export function listGateways(): GatewayConnection[] {
  return load().gateways
}

export function getActiveGateway(): GatewayConnection {
  const store = load()

  return store.gateways.find(g => g.id === store.activeId) ?? store.gateways[0]
}

export function addGateway(input: { name: string; url: string; authMode: 'oauth' | 'token'; token?: string }): string {
  const store = load()
  const id = newId()
  store.gateways.push({
    id,
    name: input.name.trim() || 'Gateway',
    url: input.url.trim(),
    authMode: input.authMode,
    token: input.token ?? ''
  })
  commit(store)

  return id
}

export function updateGateway(id: string, patch: Partial<Omit<GatewayConnection, 'id'>>): void {
  const store = load()
  const gateway = store.gateways.find(g => g.id === id)

  if (!gateway) { return }

  if (patch.name !== undefined) { gateway.name = patch.name.trim() || gateway.name }

  if (patch.url !== undefined) { gateway.url = patch.url.trim() }

  if (patch.authMode !== undefined) { gateway.authMode = patch.authMode }

  if (patch.token !== undefined) { gateway.token = patch.token }
  commit(store)
}

/** Remove a gateway. The last remaining gateway cannot be removed. */
export function removeGateway(id: string): void {
  const store = load()

  if (store.gateways.length <= 1) { return }
  store.gateways = store.gateways.filter(g => g.id !== id)

  if (store.activeId === id) { store.activeId = store.gateways[0].id }
  commit(store)
}

// Soft switch: swap gateways in-app — the boot hook reboots the socket against
// the new gateway and the sidebar cache swaps the shell, all keyed off the
// $activeGatewayId change `commit()` emits below. This avoids the full-page
// reload (bundle re-parse + blank connecting screen) on every switch. Flip to
// false to restore the old reload-on-switch behavior as a fallback.
const SOFT_GATEWAY_SWITCH = true

/**
 * Set the active gateway. By default this is now a soft in-app swap; pass
 * `{ reload: true }` to force the legacy full-page reload.
 */
export function setActiveGateway(id: string, opts: { reload?: boolean } = {}): void {
  const store = load()

  if (!store.gateways.some(g => g.id === id) || store.activeId === id) { return }
  store.activeId = id
  // Emits $activeGatewayId, which drives the soft swap (boot reboot + sidebar
  // shell swap). Routing must be updated first so the new socket and any OAuth
  // callback navigation both target the newly active gateway.
  commit(store)
  syncDevGatewayCookie()

  const reload = opts.reload ?? !SOFT_GATEWAY_SWITCH

  if (reload) {
    setTimeout(() => window.location.reload(), 50)
  }
}
