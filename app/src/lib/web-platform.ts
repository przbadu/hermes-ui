/**
 * Platform capability predicates for the browser (web) build.
 *
 * The renderer was written against Electron's `window.hermesDesktop` preload
 * bridge. The web build (`@/web-bridge/bridge`) supplies a shim that implements
 * everything web-capable and either OMITS or inertly stubs Electron-only
 * surfaces. These helpers let UI code hide affordances that cannot work in a
 * browser, instead of rendering dead buttons or throwing.
 *
 * Detection prefers a capability probe over a brittle userAgent sniff: we ask
 * whether a specific Electron-only bridge member exists rather than guessing
 * from the environment.
 */

/**
 * True when running as the browser (web) build rather than inside Electron.
 *
 * Signal: the web bridge intentionally OMITS `terminal` (a local PTY has no
 * browser equivalent), so its absence is a reliable, stable marker of the web
 * build. Electron always ships a real `terminal` bridge.
 */
export function isWebPlatform(): boolean {
  return typeof window !== 'undefined' && !window.hermesDesktop?.terminal
}

/**
 * True when a local PTY (the in-app terminal) is available. The web bridge omits
 * the `terminal` member entirely, so this is a direct presence probe.
 */
export function supportsLocalPty(): boolean {
  return typeof window !== 'undefined' && !!window.hermesDesktop?.terminal
}

/**
 * True when native window zoom is available. The web bridge omits `zoom`
 * (browser page zoom is the user's own Ctrl/Cmd +/-), so this is a direct
 * presence probe.
 */
export function supportsWindowZoom(): boolean {
  return typeof window !== 'undefined' && !!window.hermesDesktop?.zoom
}

/**
 * True when the app can update itself (the Electron auto-updater). The web
 * bridge keeps an inert `updates` stub whose `check()` resolves
 * `{ supported: false }`, so presence cannot distinguish it — fall back to the
 * general web-platform check. This gates only the CLIENT/app self-update; the
 * separate BACKEND update feature runs over REST and is unaffected.
 */
export function supportsAppAutoUpdate(): boolean {
  return !isWebPlatform()
}

/**
 * True when the app can uninstall itself. The web bridge keeps an inert
 * `uninstall` stub whose methods throw, so presence cannot distinguish it —
 * fall back to the general web-platform check. A browser tab has nothing to
 * uninstall.
 */
export function supportsUninstall(): boolean {
  return !isWebPlatform()
}

/**
 * True when the VS Code theme marketplace is reachable. The web bridge keeps an
 * inert `themes` stub (`fetchMarketplace` throws, `searchMarketplace` returns
 * `[]`), so presence cannot distinguish it — fall back to the general
 * web-platform check. The gateway proxies no marketplace, so the browser can
 * only offer local themes.
 */
export function supportsMarketplaceThemes(): boolean {
  return !isWebPlatform()
}

/**
 * True when a native OS folder picker can set the default project directory.
 * The web bridge keeps an inert `settings` stub whose `pickDefaultProjectDir`
 * resolves `{ canceled: true }`, so presence cannot distinguish it — fall back
 * to the general web-platform check. The browser has no native directory dialog.
 */
export function supportsDefaultProjectDir(): boolean {
  return !isWebPlatform()
}

/**
 * True when local app log files can be revealed/read. The web bridge keeps
 * inert `revealLogs`/`getRecentLogs` stubs (no-op / empty), so presence cannot
 * distinguish them — fall back to the general web-platform check. A browser has
 * no on-disk log directory to open.
 */
export function supportsLogAccess(): boolean {
  return !isWebPlatform()
}
