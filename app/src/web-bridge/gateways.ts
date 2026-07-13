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
