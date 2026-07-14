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
  DesktopOauthLoginResult,
  HermesApiRequest,
  HermesConnection,
  HermesNotification
} from '@/global'

import { classifyGatewayReach, getActiveGateway, normalizeBase, servingBase, updateGateway } from './gateways'

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string
    __HERMES_BASE_PATH__?: string
    /** Dev only: the gateway origin the Vite proxy forwards to (see vite.config.ts). */
    __HERMES_DEV_PROXY_TARGET__?: string
    /** Dev only: gateway origins the developer whitelisted as reachable
     *  (HERMES_GATEWAY_URL + repo-root config.json; see vite.config.ts). */
    __HERMES_GATEWAY_WHITELIST__?: string[]
  }
}

const TOKEN_STORAGE_KEY = 'hermes-web.session-token'

const noop = (): void => {}
const unsubscribed = (): (() => void) => noop

/**
 * The bridge always operates on the ACTIVE gateway (see `./gateways`). This is
 * the adapter shape the connection-config methods below speak; it is derived
 * from, and written back to, the active gateway entry.
 */
interface StoredConnection {
  mode: 'local' | 'remote'
  remoteAuthMode: 'oauth' | 'token'
  remoteToken: string
  remoteUrl: string
}

function loadStoredConnection(): StoredConnection {
  const gateway = getActiveGateway()

  return {
    mode: 'remote',
    remoteAuthMode: gateway.authMode,
    remoteToken: gateway.token ?? '',
    remoteUrl: gateway.url || servingBase()
  }
}

function persistConnection(input: DesktopConnectionConfigInput): StoredConnection {
  updateGateway(getActiveGateway().id, {
    ...(input.remoteAuthMode !== undefined ? { authMode: input.remoteAuthMode } : {}),
    // An omitted token means "leave the saved one unchanged".
    ...(input.remoteToken !== undefined ? { token: input.remoteToken } : {}),
    ...(input.remoteUrl !== undefined ? { url: input.remoteUrl.trim() } : {})
  })

  return loadStoredConnection()
}

function baseUrl(): string {
  return normalizeBase(getActiveGateway().url)
}

/**
 * Token resolution order: gateway HTML injection (loopback/token mode), a
 * `?token=` URL param (persisted then stripped so it never lingers in the
 * address bar), a previously persisted param token, then a token saved on the
 * active gateway. Empty string means cookie (gated/OAuth) mode.
 */
function resolveToken(): string {
  if (window.__HERMES_SESSION_TOKEN__) {return window.__HERMES_SESSION_TOKEN__}

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

    if (stored) {return stored}
  } catch {
    // fall through to the active gateway's token
  }

  const gateway = getActiveGateway()

  return gateway.authMode === 'token' ? (gateway.token ?? '') : ''
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

  if (!body.ticket) {throw new Error('ws-ticket response had no ticket')}

  return body.ticket
}

/**
 * True when the active gateway currently has a usable session. Token gateways
 * are "connected" if a token is present; OAuth/cookie gateways are probed via
 * the public-ish /api/auth/me (200 = signed in, 401 = not). Best-effort: any
 * failure reports not-connected so the UI offers a sign-in path rather than
 * falsely claiming a live session.
 */
async function probeAuthConnected(base: string = baseUrl()): Promise<boolean> {
  if (resolveToken()) {
    return true
  }

  try {
    const res = await fetch(`${base}/api/auth/me`, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(6_000)
    })

    return res.ok
  } catch {
    return false
  }
}

/**
 * True when `base` shares the app's origin. OAuth in the browser only works
 * same-origin: the gateway sets its session as an `HttpOnly; SameSite=Lax`
 * cookie with no credentialed CORS, so the browser refuses to send it back on a
 * cross-origin fetch/WS. Same-origin covers the zero-config default gateway and
 * any `/prefix` gateway (both resolve to the serving origin, which the Vite dev
 * proxy or the gateway's own static host routes through), plus production where
 * the gateway serves the app. An absolute cross-origin URL never can.
 */
function isSameOrigin(base: string): boolean {
  try {
    return new URL(base, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * Browser equivalent of the desktop's `openOauthLoginWindow`: open the
 * gateway's `/login` in a child window and poll our own (same-origin) session
 * until it goes live, resolving `connected: true` then. The app window is never
 * navigated away - exactly the desktop behaviour. Resolves `connected: false`
 * if the popup is blocked, the user closes it before finishing, or the login
 * doesn't complete within the timeout.
 */
function openOauthLoginPopup(base: string): Promise<DesktopOauthLoginResult> {
  return new Promise(resolve => {
    const popup = window.open(`${base}/login`, 'hermes-oauth-login', 'width=520,height=720')

    if (!popup) {
      resolve({ ok: false, baseUrl: base, connected: false })

      return
    }

    // Sever the popup's back-reference to us so a later cross-origin page (the
    // IDP, or any redirect it makes) can't drive our window via window.opener
    // (reverse tabnabbing). We can't pass `noopener` to window.open because that
    // returns null and we need the handle to poll `.closed` / call `.close()`.
    // Safe to set here: the popup is still on our same-origin `/login`.
    try {
      popup.opener = null
    } catch {
      // Some browsers make opener read-only; the poll/close path still works.
    }

    let settled = false
    const startedAt = Date.now()
    const TIMEOUT_MS = 5 * 60_000

    const finish = (connected: boolean): void => {
      if (settled) {return}
      settled = true
      clearInterval(timer)

      try {
        if (!popup.closed) {popup.close()}
      } catch {
        // Closing a window we opened is always allowed, but guard anyway.
      }

      resolve({ ok: true, baseUrl: base, connected })
    }

    // The gateway lands on `/` (a valid authenticated page) after the callback
    // sets the cookies; we only care that the cookie jar is populated, which we
    // observe from the app window via /api/auth/me now that it's same-origin.
    const timer = setInterval(() => {
      void (async () => {
        if (settled) {return}

        if (await probeAuthConnected(base)) {
          finish(true)

          return
        }

        if (popup.closed || Date.now() - startedAt > TIMEOUT_MS) {
          finish(false)
        }
      })()
    }, 600)
  })
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

  if (body !== undefined) {headers['Content-Type'] = 'application/json'}

  if (token) {headers['X-Hermes-Session-Token'] = token}

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_API_TIMEOUT_MS)
  })

  const text = await res.text()

  if (!res.ok) {
    // Do NOT navigate away on 401. The app shell must stay mounted so the user
    // can reach Settings -> Gateway (change the URL, switch gateways, sign in).
    // Boot surfaces the reauth state via the WS path (getGatewayWsUrl ->
    // GatewayReauthRequiredError) which drives the boot-failure sign-in branch.
    // Same error contract as the Electron IPC handler: reject with "NNN: msg".
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }

  if (!text) {return null as T}
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

async function toConnectionConfig(stored: StoredConnection): Promise<DesktopConnectionConfig> {
  const token = resolveToken()
  const hasToken = stored.remoteAuthMode === 'token' && Boolean(stored.remoteToken || token)
  // Reflect the REAL session state so isRemoteReauthFailure() can decide whether
  // to show the sign-in branch. Reporting a false "connected" here would hide
  // the sign-in path and strand the user on a dead connection.
  const remoteOauthConnected = stored.remoteAuthMode === 'oauth' ? await probeAuthConnected() : false

  return {
    // The web build has no environment overrides, so the settings screen is
    // always editable.
    envOverride: false,
    mode: stored.mode,
    profile: null,
    remoteAuthMode: stored.remoteAuthMode,
    remoteOauthConnected,
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

  if (!res.ok) {throw new Error(`${res.status}: ${res.statusText}`)}

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
  if (!('Notification' in window)) {return false}

  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }

  if (Notification.permission !== 'granted') {return false}
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

      if (token) {return buildTokenWsUrl(token)}
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

      // A different-origin gateway is blocked by the browser (mixed content +
      // localhost-only CORS) before the fetch is meaningful. Report the real
      // reason via `error` so the UI explains it, instead of firing a doomed
      // request that surfaces as a generic "could not reach".
      const block = classifyGatewayReach(remoteUrl)

      if (block) {
        return { baseUrl: base, reachable: false, authMode: 'unknown', providers: [], version: null, error: block }
      }

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

      // A cross-origin absolute URL can never hold a login session in the
      // browser (see isSameOrigin). Fail loudly with guidance instead of
      // navigating the tab to the gateway's own dashboard and stranding the
      // user there - the exact symptom this replaces.
      if (!isSameOrigin(base)) {
        throw new Error(
          `This gateway (${base}) is on a different origin than the app, so the browser ` +
            'will not keep its login session after sign-in. Reach it on the same origin ' +
            'instead: point the dev proxy (HERMES_GATEWAY_URL) at it and leave the gateway ' +
            "URL blank, or use a session token. Desktop can use an absolute URL; the browser can't."
        )
      }

      // Same-origin: mirror the desktop popup so the app stays mounted.
      return openOauthLoginPopup(base)
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
