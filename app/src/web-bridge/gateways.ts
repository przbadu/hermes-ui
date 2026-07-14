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
 * In `vite dev`, requests to /api, /auth, and /login are proxied to the gateway
 * named by HERMES_GATEWAY_URL (see vite.config.ts) so the browser only ever
 * talks to the Vite origin and the gateway's session cookie stays same-origin.
 * If the user typed that same gateway's own absolute URL, route it back through
 * the serving origin so OAuth (cookies + WS tickets) works exactly as it does
 * for the zero-config default gateway - a cross-origin absolute URL cannot hold
 * a browser session (HttpOnly, SameSite=Lax, no credentialed CORS). Outside dev,
 * or for any other origin, the absolute URL is used verbatim.
 */
function rewriteThroughDevProxy(absoluteUrl: string): string {
  const target = window.__HERMES_DEV_PROXY_TARGET__

  if (!target) {return absoluteUrl}

  try {
    if (new URL(absoluteUrl).origin === new URL(target).origin) {return servingBase()}
  } catch {
    // Unparseable target/url: fall through and use the URL verbatim.
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

  if (!value) {return servingBase()}

  if (/^https?:\/\//i.test(value)) {return rewriteThroughDevProxy(value)}

  if (value.startsWith('/')) {return window.location.origin + value}

  return servingBase()
}

/**
 * Why a gateway `url` can't be reached from THIS browser, or `null` when it can.
 *
 * A browser tab can reach:
 *   - a SAME-ORIGIN gateway: the serving origin, a `/prefix` on it, or - in dev -
 *     the URL the Vite proxy forwards to (all resolved to the serving origin by
 *     `normalizeBase`);
 *   - any LOOPBACK gateway when the app is itself served from loopback
 *     (localhost:5174 -> localhost:9200): same-site, only the port differs;
 *   - any WHITELISTED gateway - an origin the developer explicitly trusts via
 *     `HERMES_GATEWAY_URL` or repo-root `config.json` (injected as
 *     `__HERMES_GATEWAY_WHITELIST__`). This is how you opt a remote gateway in:
 *     the Hermes gateway's CORS trusts the localhost app origin and the app
 *     authenticates with a header token + `?token=` WS param, so token-auth REST
 *     and WS work directly, no cookie crossing origins.
 * The only hard block is `mixed-content` (an https page cannot fetch an http
 * gateway at all). Anything else non-loopback and un-whitelisted is reported as
 * `cross-origin` so the UI can explain it instead of firing a doomed request.
 * OAuth *cookie* sessions still require same-origin (no cross-origin
 * Access-Control-Allow-Credentials); that path guards itself and points the user
 * at a token or the dev proxy.
 */
export type GatewayReachBlock = 'mixed-content' | 'cross-origin'

/** Loopback hosts, which the browser treats as one site regardless of port. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()

  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
}

/**
 * Origins the developer has whitelisted as reachable, from `HERMES_GATEWAY_URL`
 * plus repo-root `config.json` (see app/vite.config.ts). Dev-only; empty in a
 * production build. Compared by URL origin, so a trailing path/slash is ignored.
 */
function isWhitelistedGateway(target: URL): boolean {
  const list = window.__HERMES_GATEWAY_WHITELIST__

  if (!Array.isArray(list)) {return false}

  return list.some(entry => {
    try {
      return new URL(entry).origin === target.origin
    } catch {
      return false
    }
  })
}

export function classifyGatewayReach(url: string): GatewayReachBlock | null {
  try {
    const target = new URL(normalizeBase(url), window.location.href)

    if (target.origin === window.location.origin) {return null}

    // An https page can never fetch an http gateway, whitelisted or not.
    if (window.location.protocol === 'https:' && target.protocol === 'http:') {return 'mixed-content'}

    // A loopback gateway reached from a loopback app is same-site (only the port
    // differs) - reachable with no configuration.
    if (isLoopbackHost(target.hostname) && isLoopbackHost(window.location.hostname)) {return null}

    // A gateway the developer explicitly whitelisted (HERMES_GATEWAY_URL /
    // config.json). Token-auth REST + WS work directly; adding it in Settings
    // then connects instead of being pre-blocked.
    if (isWhitelistedGateway(target)) {return null}

    return 'cross-origin'
  } catch {
    // Unparseable input: let the normal probe/validation surface it.
    return null
  }
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
    gateways: [{ id: DEFAULT_ID, name: 'This gateway', url: '', authMode: 'oauth' }]
  }
}

function migrateLegacy(): GatewayStore | null {
  try {
    const raw = localStorage.getItem(LEGACY_CONNECTION_KEY)

    if (!raw) {return null}

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
          name: 'This gateway',
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

  if (gateways.length === 0) {return defaultStore()}
  const activeId = gateways.some(g => g.id === store.activeId) ? (store.activeId as string) : gateways[0].id

  return { version: 1, activeId, gateways }
}

function load(): GatewayStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (raw) {return sanitize(JSON.parse(raw) as Partial<GatewayStore>)}
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

  if (!gateway) {return}

  if (patch.name !== undefined) {gateway.name = patch.name.trim() || gateway.name}

  if (patch.url !== undefined) {gateway.url = patch.url.trim()}

  if (patch.authMode !== undefined) {gateway.authMode = patch.authMode}

  if (patch.token !== undefined) {gateway.token = patch.token}
  commit(store)
}

/** Remove a gateway. The last remaining gateway cannot be removed. */
export function removeGateway(id: string): void {
  const store = load()

  if (store.gateways.length <= 1) {return}
  store.gateways = store.gateways.filter(g => g.id !== id)

  if (store.activeId === id) {store.activeId = store.gateways[0].id}
  commit(store)
}

/** Set the active gateway. Reloads by default so the app re-boots against it. */
export function setActiveGateway(id: string, opts: { reload?: boolean } = {}): void {
  const store = load()

  if (!store.gateways.some(g => g.id === id) || store.activeId === id) {return}
  store.activeId = id
  commit(store)

  if (opts.reload !== false) {
    setTimeout(() => window.location.reload(), 50)
  }
}
