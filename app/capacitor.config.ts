import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor native (Android/iOS) configuration for the Hermes app.
 *
 * The whole point of the native build is to escape the browser's same-origin
 * constraint. In the browser the app MUST be same-origin with the gateway: the
 * gateway's CORS is localhost-only, its session cookie is HttpOnly SameSite=Lax
 * host-only, and its WebSocket rejects foreign http(s) origins. Native sidesteps
 * all three - CapacitorHttp performs requests from the OS network stack (no CORS
 * preflight, native cookie jar, no SameSite gate) and the WebView's own origin
 * is what the gateway's WS origin check sees. So on native the app can talk to a
 * REMOTE cross-origin gateway.
 *
 * CAVEAT (validate on hardware, see CAPACITOR.md): iOS uses `capacitor://local`
 * host - a non-http origin the gateway's WS check is documented to trust. Android
 * uses `https://localhost` (see `androidScheme` below), which IS an http(s)
 * origin; whether the gateway accepts it (host-based allowlist) or rejects it
 * (scheme-based foreign-origin block) is unverified here and gates whether the
 * Android WS connects at all. Do not treat Android native as functional until
 * this is confirmed against a running gateway.
 *
 * Because of that we deliberately do NOT point `server.url` at a gateway. The
 * app ships as bundled assets and the remote gateway is chosen at runtime,
 * in-app (Settings -> Gateway), exactly like the web build's gateway switcher.
 */
const config: CapacitorConfig = {
  appId: 'ai.hermes.app',
  appName: 'Hermes',
  // The Vite build output. `cap sync` copies this into the native projects.
  webDir: 'dist',
  android: {
    // Serve the bundled assets over https://localhost rather than the older
    // http scheme so the WebView runs in a secure context (needed for the
    // clipboard, crypto.randomUUID, notifications, etc. the app relies on).
    androidScheme: 'https'
  },
  // We intentionally leave `server` unset. The app loads its bundled assets and
  // connects to whichever gateway the user configures at runtime. Do NOT set
  // `server.url` to a gateway - that would make the WebView itself an http(s)
  // origin, which reintroduces exactly the CORS/cookie/WS-origin problems the
  // native build exists to avoid, and would break offline launch.
  //
  // server: {
  //   // Dev-only live reload example (never ship this): point the WebView at a
  //   // Vite dev server on your LAN. Keep it commented out for release builds.
  //   // url: 'http://192.168.1.10:5174',
  //   // cleartext: true
  // },
  plugins: {
    SplashScreen: {
      // A short, spinner-less launch: the app shell mounts fast, so a long or
      // animated splash would just add perceived latency. We fade it out
      // quickly and let the app's own boot UI take over.
      launchShowDuration: 300,
      launchAutoHide: true,
      showSpinner: false,
      androidSpinnerStyle: 'small',
      splashFullScreen: true,
      splashImmersive: false
    }
  }
}

export default config
