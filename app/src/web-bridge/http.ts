/**
 * The single HTTP entry point for the web bridge.
 *
 * Every REST call the bridge makes (see `./bridge`) is meant to route through
 * `hermesHttp` so there is exactly ONE place that decides the transport:
 *
 *  - Browser / Electron build: plain `fetch`, preserving today's behavior
 *    byte-for-byte (`credentials: 'same-origin'`, `AbortSignal.timeout`). The
 *    same-origin constraint is intentional there - the gateway's CORS is
 *    localhost-only and its session cookie is HttpOnly SameSite=Lax host-only,
 *    so a cross-origin browser fetch cannot carry the session anyway.
 *
 *  - Native (Capacitor) build: `CapacitorHttp`, which issues the request from
 *    the OS network stack instead of the WebView. That bypasses CORS entirely
 *    (no preflight, no origin gate), uses the native cookie jar rather than the
 *    document's (so HttpOnly/SameSite=Lax cookies are stored and replayed for
 *    us), and follows redirects natively. This is what lets the native app talk
 *    to a REMOTE, cross-origin gateway - the escape hatch the browser lacks.
 *
 * The return shape is a small normalized subset of the `Response` API - just
 * what the bridge's callers use - so both transports look identical to callers
 * and they can keep building the renderer's "NNN: message" error contract from
 * `status` / `statusText` / `text()`.
 */
import { CapacitorHttp } from '@capacitor/core'

import { isNativePlatform } from '@/lib/native-platform'

export interface HermesHttpRequest {
  url: string
  /** Defaults to GET, matching `fetch`. */
  method?: string
  headers?: Record<string, string>
  /** Already-serialized request body (the bridge JSON.stringify's before calling). */
  body?: string
  /**
   * Only honored on the fetch path. Native (CapacitorHttp) always uses the OS
   * cookie jar and has no notion of `same-origin` vs `include`, so this is a
   * no-op there. Defaults to 'same-origin' to match today's bridge behavior.
   */
  credentials?: RequestCredentials
  /**
   * Abort signal for the fetch path (the bridge passes `AbortSignal.timeout`).
   * CapacitorHttp cannot be aborted mid-flight, so on native this is ignored in
   * favor of `timeoutMs` below.
   */
  signal?: AbortSignal
  /**
   * Timeout in milliseconds. Used on the native path to set CapacitorHttp's
   * connect/read timeouts (its only cancellation mechanism). The fetch path
   * relies on `signal` instead, so this is optional and native-oriented.
   */
  timeoutMs?: number
}

/**
 * A normalized response, mirroring the slice of the `Response` API the bridge
 * uses. `text()` / `json()` are resolved eagerly under the hood (every caller
 * fully reads the body), so they are safe to call more than once.
 */
export interface HermesHttpResponse {
  ok: boolean
  status: number
  statusText: string
  text(): Promise<string>
  json(): Promise<unknown>
}

async function fetchRequest(request: HermesHttpRequest): Promise<HermesHttpResponse> {
  const res = await fetch(request.url, {
    method: request.method ?? 'GET',
    headers: request.headers,
    body: request.body,
    credentials: request.credentials ?? 'same-origin',
    signal: request.signal
  })

  // Read the body once, up front. The `Response` body stream is single-use, so
  // returning `() => res.text()` would throw "body already used" on a second
  // read. Capturing the text here makes the accessors idempotent - matching the
  // native path and the documented contract - and callers still pay the read
  // exactly once.
  const bodyText = await res.text()

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText)
  }
}

async function nativeRequest(request: HermesHttpRequest): Promise<HermesHttpResponse> {
  // responseType 'text' asks CapacitorHttp not to parse the body, but note its
  // documented caveat: a response whose content-type is "json" is parsed to an
  // object regardless. So `data` may be either a string or an already-parsed
  // value, and the accessors below normalize both directions.
  const res = await CapacitorHttp.request({
    url: request.url,
    method: request.method ?? 'GET',
    headers: request.headers,
    data: request.body,
    responseType: 'text',
    ...(request.timeoutMs !== undefined
      ? { connectTimeout: request.timeoutMs, readTimeout: request.timeoutMs }
      : {})
  })

  const asText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)

  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    // CapacitorHttp does not surface the HTTP reason phrase; callers fall back
    // to the response text for their "NNN: message" errors, which is populated.
    statusText: '',
    text: async () => asText,
    json: async () => (typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
  }
}

/**
 * Perform an HTTP request through the correct transport for the current build.
 * Native uses CapacitorHttp (cross-origin capable, native cookie jar); every
 * other build uses `fetch` with the exact same-origin behavior as before.
 */
export async function hermesHttp(request: HermesHttpRequest): Promise<HermesHttpResponse> {
  return isNativePlatform() ? nativeRequest(request) : fetchRequest(request)
}
