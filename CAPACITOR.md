# Capacitor / Android runbook

This is the build-and-run runbook for the native Android wrapper of `hermes-ui` (PLAN.md milestone M5).
The native shell exists for one reason: to escape the browser's same-origin constraint.

In the browser the app MUST be same-origin with the gateway, because the gateway's CORS is localhost-only, its session cookie is HttpOnly `SameSite=Lax` host-only, and its WebSocket rejects foreign `http(s)` origins with close code `4403`.
Native sidesteps all three.
`CapacitorHttp` issues requests from the OS network stack (no CORS preflight, native cookie jar, no `SameSite` gate), and the WebView's origin is trusted by the gateway's WS origin check.
So the native app can point at a REMOTE, cross-origin gateway that a browser build never could.

The app ships as bundled assets with no `server.url`, so the gateway is chosen at runtime in-app (Settings -> Gateway), exactly like the web build's gateway switcher.

## How the native build differs from the web build

Nothing in the renderer is forked.
The native branch is guarded by `isNativePlatform()` (from `@/lib/native-platform`, backed by Capacitor's own `Capacitor.isNativePlatform()`), which is distinct from `isWebPlatform()` (Electron-vs-browser).

- REST goes through `hermesHttp` (`@/web-bridge/http`), which routes to `CapacitorHttp` on native and to plain same-origin `fetch` everywhere else.
- The cross-origin / mixed-content guards in `gateways.ts` and the `isSameOrigin` OAuth guard in `bridge.ts` are relaxed only when `isNativePlatform()` is true.
- The WebSocket stays a plain browser `WebSocket`.
  It is not routed through `CapacitorHttp`; the gateway's WS origin check trusts the native WebView origin, so cross-origin WS works without a transport change.

## Prerequisites

- A JDK.
  JDK **21** is required, not 17: Capacitor 8's Android libraries compile against source release 21, and building on JDK 17 fails with `error: invalid source release: 21`.
  Android Studio bundles a suitable JBR 21; point `JAVA_HOME` at it (for example `/snap/android-studio/<build>/jbr`) or install a standalone JDK 21.
- Android Studio (latest stable), which bundles the Android SDK, platform-tools, and an emulator image.
- The Android SDK reachable via the `ANDROID_HOME` (or legacy `ANDROID_SDK_ROOT`) environment variable, or an `android/local.properties` with `sdk.dir=/path/to/Android/sdk`.
  Android Studio writes `local.properties` for you the first time you open the project.
- Gradle is NOT a separate install; the checked-in `android/gradlew` wrapper downloads the pinned Gradle version on first run.
- `bun` for the web build (this repo's package manager), and Node for the `cap` CLI (`npx`).

## Build the web bundle and sync it into the native project

Run everything from `app/`.

```sh
cd app
bun install
bun run build          # produces app/dist (index.html + assets/, the PWA service worker, icons)
bun run cap:sync       # copies dist into android/ and updates native plugins
```

`cap sync` does two things: it copies `dist/` into `android/app/src/main/assets/public`, and it regenerates the native config (`capacitor.config.json`, `config.xml`) from `capacitor.config.ts`.
Those copied and generated files are git-ignored on purpose (they are derived from `dist/` and `capacitor.config.ts`), so always run `bun run build` before `cap:sync` after any UI change.

## Add the Android project (first time only)

The `android/` project is checked into the repo, so you normally skip this.
If `android/` is missing (for example a fresh clone where it was intentionally excluded), regenerate it:

```sh
cd app
bun run build
bun run cap:add:android   # npx cap add android
bun run cap:sync
```

## Open, run, and build

```sh
cd app
bun run cap:android       # npx cap open android - opens the project in Android Studio
```

From Android Studio, select a device or emulator and press Run.
Or from the command line, once an SDK is configured:

```sh
cd app/android
export JAVA_HOME=/snap/android-studio/<build>/jbr   # JDK 21 (see prerequisites)
export ANDROID_HOME="$HOME/Android/Sdk"
./gradlew :app:assembleDebug          # builds app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:installDebug           # builds and installs on a connected device/emulator
```

This debug build is VERIFIED: `assembleDebug` produces a ~20 MB `app-debug.apk` against Android SDK platform 36 with JBR 21.
It was not installed or run, since that needs a device/emulator.

For an internal-track release build you produce a signed App Bundle (`./gradlew :app:bundleRelease`) with your own keystore.
Keystores and the `*.apk` / `*.aab` outputs are git-ignored and must never be committed.

## Configure the remote gateway in-app

The native app launches to its own bundled UI with no gateway wired, because there is no `server.url`.

1. Open Settings -> Gateway.
2. Add a gateway with its absolute URL, for example `https://gateway.example.com` (a real remote host, not `localhost`, is the whole point of the native build).
3. Pick the auth mode that matches the gateway (see below) and connect.

Because REST runs through `CapacitorHttp`, the cross-origin request is not subject to the browser CORS or `SameSite` rules that would block the same URL in a browser tab.

## Auth story

- Gated (OAuth) gateways.
  Sign-in relies on the session cookie.
  On native there is no document cookie jar in play; `CapacitorHttp` stores and replays the gateway's HttpOnly `SameSite=Lax` cookie through the OS/native cookie jar, so the session survives across REST calls.
  The `isSameOrigin` OAuth guard that blocks this flow in a cross-origin browser is bypassed on native.
- Token gateways.
  The bridge attaches `X-Hermes-Session-Token` on every REST call and uses a token WS URL, so there is no cookie dependency at all.
  Token mode is the most predictable path to validate first on real hardware.

## VALIDATION RISKS / TODO on real hardware

The debug APK builds cleanly (verified, see above), but it was never installed or run - there is no device/emulator here.
The items below are therefore unverified and MUST be checked on real hardware before the M5 exit criterion (an internal-track Android build authenticating against a remote gated gateway) can be called done.

- WebSocket Origin header.
  `capacitor.config.ts` sets `androidScheme: 'https'`, which means the Android WebView loads bundled assets from `https://localhost` and will send `Origin: https://localhost` on the WS upgrade, NOT `capacitor://`.
  The gateway's origin check rejects foreign `http(s)` origins but is CORS-locked to localhost, so `https://localhost` may pass precisely because it is a localhost origin - this is plausible but UNVERIFIED.
  Capture the exact `Origin` header the WebView sends and confirm the gateway does not close the socket with `4403`.
  If `https://localhost` is rejected, the fallback is to switch `androidScheme` back to the Capacitor scheme so the origin is `capacitor://` (the non-http origin the WS check explicitly trusts), weighed against losing the `https` secure-context guarantees the app relies on (clipboard, `crypto.randomUUID`, notifications).
- Cookie persistence across the native cookie jar and WS.
  Confirm that the gated-mode session cookie set on the first `CapacitorHttp` request is (a) replayed on subsequent REST calls and (b) available where the WS handshake needs it, and that it survives app backgrounding and relaunch.
  The ws-ticket is minted over REST and is single-use with a 30s TTL, so verify a fresh ticket is minted immediately before every connect and reconnect on native just as in the browser.
- Mobile lifecycle on native.
  Backgrounding freezes timers and can drop the socket; verify reconnect-on-resume with a fresh ticket and a resync, the same discipline the web build follows on `visibilitychange` / `pageshow` / `online`.
- Install and run on a device.
  The debug APK compiles; installing it on a device or emulator and running the end-to-end auth flow against a remote gated gateway is the remaining half of the M5 exit criterion and needs hardware.
  Store release (Play Store) is M6, not M5.
