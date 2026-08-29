/**
 * Plugin-system boot — import-time side effect, mirroring upstream's
 * app/contrib/controller.tsx ordering: core surfaces register through their
 * own modules first, bundled plugins second (so a plugin's same-id
 * contribution can override a core default).
 *
 * Imported for side effects by the desktop controller; the registry and the
 * pane host are module singletons, so nothing here needs React.
 */

import { discoverBundledPlugins } from '@/contrib/plugins'

import { registerCoreLayoutContributions, watchLayoutContributions } from './layout'

registerCoreLayoutContributions()
discoverBundledPlugins()
watchLayoutContributions()
