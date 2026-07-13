/**
 * Native-platform predicates for the Capacitor build.
 *
 * This is DISTINCT from `@/lib/web-platform`. That module answers "Electron vs.
 * browser" by probing for Electron-only bridge members (e.g. the absence of
 * `window.hermesDesktop.terminal`). This module answers a different question:
 * "are we running inside a Capacitor native WebView (Android/iOS) vs. a plain
 * web page?" - which the web-platform probe cannot tell you, because a native
 * build is still a "web" build as far as the Electron-vs-browser probe is
 * concerned. Keep the two concepts separate: `isWebPlatform()` gates
 * Electron-only affordances; `isNativePlatform()` gates the native REST/WS
 * escape hatch (CapacitorHttp, cross-origin gateways).
 *
 * Both helpers guard against SSR / no-window environments so they are safe to
 * call during module evaluation or in tests.
 */
import { Capacitor } from '@capacitor/core'

/**
 * True when running inside a Capacitor native shell (Android or iOS), as opposed
 * to a browser tab. `Capacitor.isNativePlatform()` is false for the plain web
 * build, so this cleanly distinguishes the two even though both render the same
 * bundled assets.
 */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') {return false}

  return Capacitor.isNativePlatform()
}

/**
 * The concrete platform the app is running on: 'ios', 'android', or 'web'.
 * Returns 'web' when there is no window (SSR/tests) so callers never crash.
 */
export function nativePlatform(): 'ios' | 'android' | 'web' {
  if (typeof window === 'undefined') {return 'web'}

  return Capacitor.getPlatform() as 'ios' | 'android' | 'web'
}
