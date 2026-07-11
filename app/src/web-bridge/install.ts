/**
 * Side-effect module: installs the web bridge as `window.hermesDesktop`.
 *
 * MUST be the first import in `main.tsx`. Several stores touch the bridge at
 * module-evaluation time (store/translucency, store/zoom, lib/clipboard), and
 * ES module imports execute in order, so this file has to run before them.
 *
 * Installation is skipped when a bridge already exists so the same source
 * tree still works under Electron and under test mocks.
 */
import { createWebBridge } from './bridge'

if (typeof window !== 'undefined' && !window.hermesDesktop) {
  window.hermesDesktop = createWebBridge()
}

export {}
