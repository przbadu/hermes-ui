import { registerSW } from 'virtual:pwa-register'

// autoUpdate: Workbox skips waiting and claims clients, so the newest app shell
// takes over as soon as it is precached. onNeedRefresh never fires under this
// registerType, so no prompt UI is needed here.
export function registerPwa(): void {
  registerSW({ immediate: true })
}
