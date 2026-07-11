/**
 * Browser implementation of the `window.hermesDesktop` preload bridge.
 *
 * The renderer was written against Electron's preload API, but it already has
 * a first-class "remote gateway" mode: with `connection.mode === 'remote'`
 * every filesystem/git surface routes through `api()` (REST) instead of the
 * native bridge, and the WebSocket client is plain browser `WebSocket`. This
 * shim therefore only needs real implementations for the HTTP/WS plumbing and
 * a handful of Web-API mappings; everything Electron-only is an inert stub.
 *
 * Auth modes, mirroring the gateway (`hermes_cli/web_server.py`):
 *  - Loopback/token gateway: it injects `window.__HERMES_SESSION_TOKEN__` into
 *    the served index.html. REST sends `X-Hermes-Session-Token`, WS uses
 *    `?token=`. A `?token=` URL param or localStorage token covers `vite dev`,
 *    where the page is served by Vite and the injection never happens.
 *  - Gated gateway (cookies): REST rides the browser cookie jar same-origin;
 *    WS tickets are minted per connect via POST /api/auth/ws-ticket (they are
 *    single-use with a 30s TTL, so `getGatewayWsUrl` re-mints every call and
 *    the connection advertises `authMode: 'oauth'`, which makes the renderer
 *    re-resolve the URL on every reconnect).
 */

import type {
  DesktopBootProgress,
  DesktopConnectionConfig,
  DesktopConnectionConfigInput,
  HermesApiRequest,
  HermesConnection,
  HermesNotification
} from '@/global'

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string
    __HERMES_BASE_PATH__?: string
  }
}

const TOKEN_STORAGE_KEY = 'hermes-web.session-token'
const CONNECTION_STORAGE_KEY = 'hermes-web.connection'

const noop = (): void => {}
const unsubscribed = (): (() => void) => noop

function resolveBasePath(): string {
  const raw = window.__HERMES_BASE_PATH__ ?? ''
  return raw === '/' ? '' : raw.replace(/\/$/, '')
}

/**
 * The origin the app was actually served from. This is the default gateway:
 * when the bundle is hosted by the gateway (or reached through the dev proxy),
 * the served origin IS the gateway, so everything is same-origin out of the
 * box with no configuration.
 */
function servingBase(): string {
  return window.location.origin + resolveBasePath()
}

/**
 * The user-editable connection, persisted in the browser. This mirrors the
 * desktop's Gateway settings: the user may point the app at a remote gateway
 * URL (absolute `https://host` or a `/prefix` path on the serving origin) and
 * choose token or OAuth auth. Nothing is set by environment variables here -
 * the web build has no env, so the settings screen is always editable.
 */
interface StoredConnection {
  mode: 'local' | 'remote'
  remoteAuthMode: 'oauth' | 'token'
  remoteToken: string
  remoteUrl: string
}

function defaultConnection(): StoredConnection {
  return { mode: 'remote', remoteAuthMode: 'oauth', remoteToken: '', remoteUrl: servingBase() }
}

function loadStoredConnection(): StoredConnection {
  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY)
    if (!raw) return defaultConnection()
    const parsed = JSON.parse(raw) as Partial<StoredConnection>
    return {
      mode: parsed.mode === 'local' ? 'local' : 'remote',
      remoteAuthMode: parsed.remoteAuthMode === 'token' ? 'token' : 'oauth',
      remoteToken: parsed.remoteToken ?? '',
      remoteUrl: (parsed.remoteUrl ?? '').trim() || servingBase()
    }
  } catch {
    return defaultConnection()
  }
}

function persistConnection(input: DesktopConnectionConfigInput): StoredConnection {
  const current = loadStoredConnection()
  const next: StoredConnection = {
    mode: input.mode ?? current.mode,
    remoteAuthMode: input.remoteAuthMode ?? current.remoteAuthMode,
    // An omitted token means "leave the saved one unchanged"; an explicit
    // empty string clears it.
    remoteToken: input.remoteToken !== undefined ? input.remoteToken : current.remoteToken,
    remoteUrl: (input.remoteUrl ?? current.remoteUrl).trim() || servingBase()
  }
  localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(next))
  return next
}

/**
 * Resolve a stored `remoteUrl` to an absolute base:
 * - `https://host[:port]` is used as-is.
 * - a `/prefix` is treated as a reverse-proxy path on the serving origin.
 * - anything else falls back to the serving origin.
 * A trailing slash is always trimmed.
 */
function normalizeBase(remoteUrl: string): string {
  const value = (remoteUrl || '').trim().replace(/\/+$/, '')
  if (!value) return servingBase()
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('/')) return window.location.origin + value
  return servingBase()
}

function baseUrl(): string {
  return normalizeBase(loadStoredConnection().remoteUrl)
}

/**
 * Token resolution order: gateway HTML injection (loopback/token mode), a
 * `?token=` URL param (persisted then stripped so it never lingers in the
 * address bar), a previously persisted param token, then a token saved in the
 * connection settings. Empty string means cookie (gated/OAuth) mode.
 */
function resolveToken(): string {
  if (window.__HERMES_SESSION_TOKEN__) return window.__HERMES_SESSION_TOKEN__
  try {
    const url = new URL(window.location.href)
    const param = url.searchParams.get('token')
    if (param) {
      localStorage.setItem(TOKEN_STORAGE_KEY, param)
      url.searchParams.delete('token')
      window.history.replaceState(null, '', url.toString())
      return param
    }
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (stored) return stored
  } catch {
    // fall through to the settings-provided token
  }
  const conn = loadStoredConnection()
  return conn.remoteAuthMode === 'token' ? conn.remoteToken : ''
}

function wsBaseUrl(): string {
  const httpBase = baseUrl()
  return httpBase.replace(/^http/, 'ws')
}

function buildTokenWsUrl(token: string): string {
  return `${wsBaseUrl()}/api/ws?token=${encodeURIComponent(token)}`
}

async function mintWsTicket(): Promise<string> {
  const res = await fetch(`${baseUrl()}/api/auth/ws-ticket`, {
    method: 'POST',
    credentials: 'same-origin'
  })
  if (!res.ok) {
    throw new Error(`${res.status}: failed to mint websocket ticket`)
  }
  const body = (await res.json()) as { ticket?: string }
  if (!body.ticket) throw new Error('ws-ticket response had no ticket')
  return body.ticket
}

/**
 * Gated gateways answer unauthenticated requests with a 401 envelope
 * `{"error": "unauthenticated" | "session_expired", "login_url": ...}`.
 * Redirect to the gateway login page so the cookie session gets established,
 * then the SPA reloads authenticated.
 */
function handleUnauthenticated(text: string): void {
  try {
    const body = JSON.parse(text) as { error?: string; login_url?: string }
    if (body.error === 'unauthenticated' || body.error === 'session_expired') {
      window.location.href = body.login_url || `${baseUrl()}/login`
    }
  } catch {
    // Not the auth envelope; let the caller's error handling take it.
  }
}

const DEFAULT_API_TIMEOUT_MS = 30_000

async function apiFetch<T>(request: HermesApiRequest): Promise<T> {
  const { body, method = 'GET', path, profile, timeoutMs } = request
  let url = baseUrl() + path
  if (profile) {
    url += `${url.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`
  }
  const token = resolveToken()
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['X-Hermes-Session-Token'] = token
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_API_TIMEOUT_MS)
  })
  const text = await res.text()
  if (!res.ok) {
    if (res.status === 401 && !token) handleUnauthenticated(text)
    // Same contract as the Electron IPC handler: reject with "NNN: message".
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }
  if (!text) return null as T
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<')) {
    throw new Error(`Expected JSON from ${url} but got HTML`)
  }
  return JSON.parse(text) as T
}

function connection(profile?: string | null): HermesConnection {
  const token = resolveToken()
  return {
    baseUrl: baseUrl(),
    mode: 'remote',
    source: 'settings',
    // 'oauth' forces the renderer to re-resolve the WS URL through
    // getGatewayWsUrl on every reconnect, which cookie mode needs because
    // tickets are single-use.
    authMode: token ? 'token' : 'oauth',
    token,
    wsUrl: token ? buildTokenWsUrl(token) : '',
    logs: [],
    isFullscreen: false,
    nativeOverlayWidth: 0,
    windowButtonPosition: null,
    ...(profile ? { profile } : {})
  }
}

function toConnectionConfig(stored: StoredConnection): DesktopConnectionConfig {
  const token = resolveToken()
  const hasToken = stored.remoteAuthMode === 'token' && Boolean(stored.remoteToken || token)
  return {
    // The web build has no environment overrides, so the settings screen is
    // always editable.
    envOverride: false,
    mode: stored.mode,
    profile: null,
    remoteAuthMode: stored.remoteAuthMode,
    remoteOauthConnected: stored.remoteAuthMode === 'oauth',
    remoteTokenPreview: stored.remoteToken ? `...${stored.remoteToken.slice(-4)}` : null,
    remoteTokenSet: hasToken,
    remoteUrl: stored.remoteUrl
  }
}

/** GET /api/status against an arbitrary base, bypassing the auth header path. */
async function fetchStatus(
  base: string
): Promise<{ auth_providers?: string[]; auth_required?: boolean; version?: string } | null> {
  const res = await fetch(`${base}/api/status`, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(8_000)
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return (await res.json()) as { auth_providers?: string[]; auth_required?: boolean; version?: string }
}

function readyBootProgress(): DesktopBootProgress {
  return {
    error: null,
    fakeMode: false,
    message: 'Ready',
    phase: 'backend.ready',
    progress: 100,
    running: false,
    timestamp: Date.now()
  }
}

async function webNotify(payload: HermesNotification): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }
  if (Notification.permission !== 'granted') return false
  new Notification(payload.title ?? 'Hermes', {
    body: payload.body,
    silent: payload.silent
  })
  return true
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Everything the web build supports. `terminal`, `git` and `zoom` are
 * intentionally absent: their consumers probe for bridge presence and
 * self-disable (terminal), or never reach the native path in remote mode
 * (git), or render nothing (zoom).
 */
type WebBridge = Omit<Window['hermesDesktop'], 'terminal' | 'git' | 'zoom'>

export function createWebBridge(): Window['hermesDesktop'] {
  const bridge: WebBridge = {
    getConnection: async profile => connection(profile),
    revalidateConnection: async () => ({ ok: true, rebuilt: false }),
    touchBackend: async () => ({ ok: true }),
    getGatewayWsUrl: async () => {
      const token = resolveToken()
      if (token) return buildTokenWsUrl(token)
      const ticket = await mintWsTicket()
      return `${wsBaseUrl()}/api/ws?ticket=${encodeURIComponent(ticket)}`
    },
    openSessionWindow: async sessionId => {
      const opened = window.open(`${window.location.pathname}#/${sessionId}`, '_blank', 'noopener')
      return opened ? { ok: true } : { ok: false, error: 'popup-blocked' }
    },
    openNewSessionWindow: async () => {
      const opened = window.open(`${window.location.pathname}#/`, '_blank', 'noopener')
      return opened ? { ok: true } : { ok: false, error: 'popup-blocked' }
    },
    petOverlay: {
      open: async () => ({ ok: false }),
      close: async () => ({ ok: true }),
      setBounds: noop,
      setIgnoreMouse: noop,
      setFocusable: noop,
      pushState: noop,
      control: noop,
      onState: unsubscribed,
      onControl: unsubscribed
    },
    getBootProgress: async () => readyBootProgress(),
    getConnectionConfig: async () => toConnectionConfig(loadStoredConnection()),
    saveConnectionConfig: async input => toConnectionConfig(persistConnection(input)),
    applyConnectionConfig: async input => {
      const next = persistConnection(input)
      // Reconnecting the live socket in place is fiddly; a reload re-runs the
      // whole boot path against the new connection, which is exactly what the
      // desktop shell does on "Save and reconnect". Defer so this promise
      // resolves (and the UI can settle) before the navigation.
      setTimeout(() => window.location.reload(), 50)
      return toConnectionConfig(next)
    },
    testConnectionConfig: async input => {
      const base = normalizeBase(input?.remoteUrl ?? loadStoredConnection().remoteUrl)
      const status = await fetchStatus(base)
      return { baseUrl: base, ok: true, version: status?.version ?? null }
    },
    probeConnectionConfig: async remoteUrl => {
      const base = normalizeBase(remoteUrl)
      try {
        const status = await fetchStatus(base)
        return {
          baseUrl: base,
          reachable: true,
          authMode: status?.auth_required ? 'oauth' : 'token',
          providers: (status?.auth_providers ?? []).map(name => ({ name, displayName: name })),
          version: status?.version ?? null,
          error: null
        }
      } catch (error) {
        return {
          baseUrl: base,
          reachable: false,
          authMode: 'unknown',
          providers: [],
          version: null,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    },
    oauthLoginConnectionConfig: async remoteUrl => {
      const base = remoteUrl ? normalizeBase(remoteUrl) : baseUrl()
      window.location.href = `${base}/login`
      return { ok: true, baseUrl: base, connected: false }
    },
    oauthLogoutConnectionConfig: async remoteUrl => {
      const base = remoteUrl ? normalizeBase(remoteUrl) : baseUrl()
      await fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'same-origin' })
      return { ok: true, connected: false }
    },
    profile: {
      get: async () => ({ profile: null }),
      set: async name => ({ profile: name })
    },
    api: apiFetch,
    notify: webNotify,
    requestMicrophoneAccess: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())
        return true
      } catch {
        return false
      }
    },
    readFileDataUrl: async () => {
      throw new Error('local file access is unavailable in the web app')
    },
    readFileText: async () => {
      throw new Error('local file access is unavailable in the web app')
    },
    selectPaths: async () => [],
    writeClipboard: async text => {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    },
    saveImageFromUrl: async url => {
      const opened = window.open(url, '_blank', 'noopener')
      return Boolean(opened)
    },
    saveImageBuffer: async (data, ext) => {
      const bytes = data instanceof Uint8Array ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data)
      const filename = `hermes-image.${ext}`
      downloadBlob(new Blob([bytes]), filename)
      return filename
    },
    saveClipboardImage: async () => '',
    getPathForFile: () => '',
    normalizePreviewTarget: async () => null,
    watchPreviewFile: async url => ({ id: '', path: url }),
    stopPreviewFileWatch: async () => true,
    setTitleBarTheme: noop,
    setNativeTheme: noop,
    setTranslucency: noop,
    setPreviewShortcutActive: noop,
    openExternal: async url => {
      window.open(url, '_blank', 'noopener')
    },
    openPreviewInBrowser: async url => {
      window.open(url, '_blank', 'noopener')
    },
    fetchLinkTitle: async url => url,
    sanitizeWorkspaceCwd: async cwd => ({ cwd: cwd ?? '', sanitized: false }),
    settings: {
      getDefaultProjectDir: async () => ({ defaultLabel: '', dir: null, resolvedCwd: '' }),
      pickDefaultProjectDir: async () => ({ canceled: true, dir: null }),
      setDefaultProjectDir: async dir => ({ dir })
    },
    revealLogs: async () => ({ ok: false, path: '' }),
    getRecentLogs: async () => ({ path: '', lines: [] }),
    readDir: async () => ({ entries: [], error: 'local file access is unavailable in the web app' }),
    onClosePreviewRequested: unsubscribed,
    onOpenUpdatesRequested: unsubscribed,
    onDeepLink: unsubscribed,
    signalDeepLinkReady: async () => ({ ok: true }),
    onWindowStateChanged: unsubscribed,
    onFocusSession: unsubscribed,
    onNotificationAction: unsubscribed,
    onPreviewFileChanged: unsubscribed,
    onBackendExit: unsubscribed,
    onPowerResume: unsubscribed,
    onBootProgress: unsubscribed,
    getBootstrapState: async () => ({
      active: false,
      manifest: null,
      stages: {},
      error: null,
      log: [],
      startedAt: null,
      completedAt: null,
      unsupportedPlatform: null
    }),
    resetBootstrap: async () => ({ ok: true }),
    repairBootstrap: async () => ({ ok: true }),
    cancelBootstrap: async () => ({ ok: true, cancelled: true }),
    onBootstrapEvent: unsubscribed,
    getVersion: async () => ({
      appVersion: '0.1.0-web',
      electronVersion: '',
      nodeVersion: '',
      platform: 'web',
      hermesRoot: ''
    }),
    getRemoteDisplayReason: async () => null,
    updates: {
      check: async () => ({ supported: false }),
      apply: async () => ({ ok: false }),
      getBranch: async () => ({ branch: '' }),
      setBranch: async () => ({ branch: '' }),
      onProgress: unsubscribed
    },
    uninstall: {
      summary: async () => {
        throw new Error('uninstall is unavailable in the web app')
      },
      run: async () => {
        throw new Error('uninstall is unavailable in the web app')
      }
    },
    themes: {
      fetchMarketplace: async () => {
        throw new Error('marketplace themes are unavailable in the web app')
      },
      searchMarketplace: async () => []
    }
  }
  return bridge as Window['hermesDesktop']
}
