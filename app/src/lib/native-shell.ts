/**
 * Native shell wiring for the Capacitor build.
 *
 * The web bundle is identical across browser, Electron, and native, so the
 * OS-shell affordances a native app needs - status bar styling, keyboard
 * resize behavior, the Android hardware back button, the launch splash - have
 * to be wired at runtime rather than baked into the build. `initNativeShell`
 * is the single place that does that, and it is a hard no-op off native so the
 * browser/Electron paths stay byte-for-byte unchanged.
 *
 * Everything here is best-effort: each plugin call is wrapped in its own
 * try/catch so a plugin that failed to install (or an OS that does not support
 * a given API) can never take down app boot. We deliberately do NOT await the
 * plugin calls in a way that blocks the render - `initNativeShell` is fired
 * alongside `registerPwa()` in main.tsx and the app mounts regardless.
 */
import { App } from '@capacitor/app'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'

import type { HapticTrigger } from '@/lib/haptics'
import { isNativePlatform } from '@/lib/native-platform'

// Guards against double-wiring. `initNativeShell` is idempotent: React strict
// mode double-invokes effects in dev and the module could in principle be
// re-imported, so we register the back-button / deep-link listeners exactly
// once and short-circuit every subsequent call.
let initialized = false

/**
 * Native implementation of the app's `HapticTrigger` (see `@/lib/haptics`).
 *
 * The default trigger is `web-haptics`, which drives the macOS trackpad actuator
 * via a warmed AudioContext and does nothing meaningful inside a mobile WebView.
 * `HapticsProvider` registers THIS trigger instead when running on native, so a
 * tap on Android/iOS produces a real device haptic.
 *
 * The web-haptics pulse pattern (an array of `{ duration, intensity }` steps
 * tuned for the trackpad) can't be replayed through Capacitor Haptics, so we
 * collapse it to a single impact whose weight tracks the pattern's peak
 * intensity: a light tap stays light, an error/success burst reads as a heavy
 * thump. It is a no-op off native and swallows its own errors so callers never
 * need to guard it.
 */
export const nativeHapticTrigger: HapticTrigger = async input => {
  if (!isNativePlatform()) {
    return
  }

  try {
    const pulses = (Array.isArray(input) ? input : input == null ? [] : [input]) as unknown as Array<{
      intensity?: number
    }>

    const peak = pulses.reduce((max, pulse) => Math.max(max, pulse.intensity ?? 0), 0)
    const style = peak >= 0.8 ? ImpactStyle.Heavy : peak >= 0.45 ? ImpactStyle.Medium : ImpactStyle.Light

    await Haptics.impact({ style })
  } catch {
    // Haptics are a nice-to-have; a device without an actuator (or a missing
    // plugin) should never surface an error to the caller.
  }
}

/**
 * Wire the native OS shell. Idempotent, and a no-op on web/Electron.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNativePlatform() || initialized) {
    return
  }

  initialized = true

  // Status bar: match the app's dark theme (theme_color #0a0a0a). We draw the
  // app behind the bar (overlay) so the shell reaches the top edge, then pick
  // the light-text style that is legible on our near-black background. On
  // Android `setBackgroundColor` paints the bar itself; iOS ignores it (the bar
  // is always transparent when overlaying) which is exactly what we want.
  try {
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#0a0a0a' })
  } catch {
    // Not fatal - the app is readable without explicit status-bar theming.
  }

  // Keyboard: resize the whole native WebView when the on-screen keyboard
  // opens. This is the native analogue of the web build's visualViewport
  // handling - shrinking the WebView reflows the layout so the composer rides
  // just above the keyboard instead of being covered by it.
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
  } catch {
    // Older plugin versions or unsupported platforms just keep the default
    // resize behavior; the composer may sit lower but stays functional.
  }

  // Android hardware back button. Capacitor has no default handler once we
  // subscribe, so we own the navigation contract: pop the in-app history stack
  // if there is somewhere to go back to, otherwise exit the app (the expected
  // Android behavior at the root of the stack). We use the browser History API
  // rather than the router directly so this stays router-agnostic and matches
  // how HashRouter tracks entries.
  try {
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack || window.history.length > 1) {
        window.history.back()
      } else {
        void App.exitApp()
      }
    })
  } catch {
    // If the App plugin is unavailable the system default (exit on back) still
    // applies, so there is nothing to recover here.
  }

  // Deep links (appUrlOpen). Stub for now: this fires when the OS hands the app
  // a custom-scheme or App/Universal Link URL. The natural use is routing an
  // OAuth callback or a shared session link into HashRouter. We register the
  // listener so links are not silently dropped, but the actual navigation is
  // left as a follow-up once the deep-link URL scheme is finalized.
  try {
    await App.addListener('appUrlOpen', event => {
      // TODO(native deep links): parse `event.url`, extract the in-app route,
      // and drive HashRouter (e.g. window.location.hash = ...). Left as a stub
      // until the URL scheme / OAuth redirect contract is defined.
      void event
    })
  } catch {
    // No deep-link support is acceptable at this stage.
  }

  // Splash screen: the config launches a short spinner-less splash and the app
  // shell mounts fast, so hide it as soon as this runs (post-mount, called from
  // main.tsx) to hand off to the app's own boot UI without extra latency.
  try {
    await SplashScreen.hide()
  } catch {
    // launchAutoHide in capacitor.config.ts is the backstop if this fails, so
    // the splash still goes away on its own.
  }
}
