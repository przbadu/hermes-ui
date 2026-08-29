/**
 * @hermes/plugin-sdk — THE plugin language, web edition. Plugin authors import
 * exactly one module and get everything; they never touch `@/…` internals.
 * Ported from upstream apps/desktop/src/sdk/index.ts against this web shell.
 *
 * Capability tiers (unchanged from upstream):
 *  - `host.state.*` — READONLY app state (nanostore atoms; `.get()` or
 *    subscribe; `useValue` in React).
 *  - `host.*` actions — curated, safe verbs (toast, navigate, new chat).
 *  - `host.request` — the gateway JSON-RPC door; the plugin's real power.
 *  - `ui.*` — the design language, so plugin UI looks native by default.
 *
 * Web deltas (every one is a documented upstream feature-detect seam — plugins
 * built for the desktop degrade exactly as they do on older desktops):
 *  - Multi-source/multi-connection doors are ABSENT: `agents`, `connections`,
 *    `ensureAgent`, `warmAgent`, `requestProfile`, `openWorkspace`. This shell
 *    talks to one gateway; single-source flows are unaffected.
 *  - `SkillsView` / `McpTab` / `ToolsetConfigPanel` are NOT exported: the web
 *    shell's implementations lack the `fixedProfile`/`embedded` scoping props,
 *    so rendering them inside a plugin dialog would read/write the ACTIVE
 *    profile instead of the plugin's target. Plugins keep their own staged
 *    fallbacks, which route every RPC through an explicit `profile` param.
 *  - `host.paneVisibility` is backed by the shared Desktop layout tree
 *    instead of the layout tree — same semantics: "holding its zone's active
 *    tab slot".
 */

import { atom, type ReadableAtom } from 'nanostores'

import { PANES_AREA } from '@/app/contrib/layout'
import { sessionRoute } from '@/app/routes'
import { dismissMobileChatSidebar } from '@/app/shell/mobile-pane-navigation'
import { $paneVisible } from '@/components/pane-shell/tree/store'
import { deleteProfile as deleteProfileRest, getLogs, getStatus, type HermesGateway } from '@/hermes'
import { $gateway, openGatewayForProfile, retireProfileGateway } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import {
  $activeGatewayProfile,
  ensureGatewayProfile,
  newSessionInProfile,
  normalizeProfileKey,
  refreshProfiles,
  selectProfile,
  setActiveProfile,
  setShowAllProfiles
} from '@/store/profile'
import {
  $activeSessionId,
  $awaitingResponse,
  $busy,
  $currentCwd,
  $currentModel,
  $gatewayState,
  setSessionProfileHint
} from '@/store/session'
import { runGatewayRestart } from '@/store/system-actions'

// -- state: readonly views over the app's live atoms -------------------------

const readonlyAtom = <T>(atomLike: ReadableAtom<T>): ReadableAtom<T> => atomLike

/** Registry source that owns the active gateway. The web shell always talks
 *  to a single gateway, which upstream models as the local/legacy primary —
 *  reported as null there, and as null here. */
const $activeConnectionId = atom<null | string>(null)

/** Window geometry + the app's responsive posture, one readonly rect. */
export interface ViewportRect {
  width: number
  height: number
  /** Below the app's sidebar-collapse breakpoint. */
  narrow: boolean
}

// Mirrors the app's sidebar-collapse breakpoint. The SDK evaluates the media
// query directly so this readonly surface stays independent of renderer state.
const NARROW_MEDIA_QUERY = '(max-width: 64rem)'

const readViewport = (): ViewportRect => ({
  width: typeof window === 'undefined' ? 0 : window.innerWidth,
  height: typeof window === 'undefined' ? 0 : window.innerHeight,
  narrow: typeof window === 'undefined' ? false : (window.matchMedia?.(NARROW_MEDIA_QUERY)?.matches ?? false)
})

const $viewport = atom<ViewportRect>(readViewport())

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => $viewport.set(readViewport()))
}

export const host = {
  state: {
    /** Runtime id of the active chat session (null on a fresh draft). */
    activeSessionId: readonlyAtom<null | string>($activeSessionId),
    /** True from send until the first assistant payload on the active chat. */
    awaitingResponse: readonlyAtom<boolean>($awaitingResponse),
    /** True while the active chat is working after a send. */
    busy: readonlyAtom<boolean>($busy),
    /** Registry source that owns the active gateway (null: local primary). */
    connectionId: readonlyAtom<null | string>($activeConnectionId),
    /** Active workspace cwd ('' when detached). */
    cwd: readonlyAtom<string>($currentCwd),
    /** Gateway socket state: 'idle' | 'connecting' | 'open' | …. Not turn-busy. */
    gateway: readonlyAtom<string>($gatewayState),
    /** Current main model slug. */
    model: readonlyAtom<string>($currentModel),
    /** Profile the live gateway is routed to. */
    profile: readonlyAtom<string>($activeGatewayProfile),
    /** Window geometry ({ width, height, narrow }). */
    viewport: readonlyAtom<ViewportRect>($viewport)
  },

  /** Runtime id of the active chat session — upstream also exposes this atom
   *  at the top level and plugins reach it via `host.activeSessionId?.get?.()`. */
  activeSessionId: readonlyAtom<null | string>($activeSessionId),

  /** Toast into the app's notification stack. */
  notify,
  notifyError,

  // NOTE: every host door is async-safe — wrapped so a sync throw from an
  // internal helper becomes a rejection a plugin's .catch() sees, never an
  // error-boundary crash.

  /** Tail an app log file (`agent` / `errors` / `gateway` / `gui` / …). */
  logs: async (...args: Parameters<typeof getLogs>) => getLogs(...args),

  /** Navigate the app router (hash routes, e.g. '/skills'). */
  navigate: (path: string) => {
    dismissMobileChatSidebar()
    window.location.hash = path.startsWith('#') ? path : `#${path}`
  },

  /** Pre-dial a profile's gateway socket in the background — pool-only, no
   *  activation, no navigation. Roster UIs call this after mount so the FIRST
   *  click on an agent doesn't pay the whole backend spawn + socket dial
   *  latency. Fire-and-forget: failures are swallowed — the click path re-runs
   *  its own ensure and surfaces errors properly. */
  warmProfile: (profile: string): void => {
    const name = (profile ?? '').trim()

    if (!name || name === $activeGatewayProfile.get()) {
      return
    }

    void openGatewayForProfile(name).catch(() => undefined)
  },

  /** Delete a profile through the same REST door core surfaces use. When the
   *  deleted profile was the live gateway's, the app is re-homed to the
   *  default profile. Rejects with the backend's error when the delete
   *  fails. */
  deleteProfile: async (profile: string): Promise<void> => {
    const name = (profile ?? '').trim()

    if (!name) {
      throw new Error('deleteProfile: profile name required')
    }

    if (normalizeProfileKey(name) === 'default') {
      throw new Error('The default profile cannot be deleted.')
    }

    // Capture before the delete; re-home after so our write is the last one.
    const wasActive = normalizeProfileKey(name) === normalizeProfileKey($activeGatewayProfile.get())

    // A warmed/open Bot Mode row owns a retained renderer socket. Retire it
    // before the delete so a reconnect can't recreate state.db mid-delete and
    // resurrect the profile directory (upstream #52279).
    retireProfileGateway(name)
    await deleteProfileRest(name)

    // The roster paints from the shared profile cache; without a refresh the
    // deleted profile's row survives. Best-effort: the delete itself already
    // succeeded.
    await refreshProfiles().catch(() => undefined)

    if (wasActive) {
      selectProfile('default')
      setActiveProfile('default')
    }
  },

  /** Open a stored session the way core surfaces do. When `profile` names a
   *  non-active profile, its backend is activated first so the resume routes
   *  to the right state.db. `keepAllProfilesScope` (default true) keeps the
   *  Sessions sidebar in the unified all-profiles view instead of narrowing it
   *  to the target profile's sessions. */
  openSession: async (
    storedSessionId: string,
    options: { intent?: string; keepAllProfilesScope?: boolean; profile?: null | string } = {}
  ): Promise<void> => {
    const profile = (options.profile ?? '').trim()

    dismissMobileChatSidebar()

    // Match Desktop's owner-hint behavior. Bot Mode's canonical chats are
    // deliberately hidden from $sessions, so this explicit profile is the
    // routing authority when the session route resumes below.
    if (profile) {
      setSessionProfileHint(storedSessionId, profile)
    }

    if (profile && profile !== $activeGatewayProfile.get()) {
      await ensureGatewayProfile(profile)

      if (options.keepAllProfilesScope !== false) {
        setShowAllProfiles(true)
      }
    }

    const route = sessionRoute(storedSessionId)
    window.location.hash = route.startsWith('#') ? route : `#${route}`
  },

  /** Start a fresh chat draft, optionally pointed at another profile (its
   *  backend spins up in the background). */
  newChat: (profile?: null | string): void => {
    dismissMobileChatSidebar()
    newSessionInProfile((profile ?? '').trim() || $activeGatewayProfile.get())
    window.location.hash = '#/'
  },

  /** Reactive on-screen visibility of a contributed pane. The contribution-
   *  scoped pane id is `<pluginId>:<paneId>`. Memoized per id — safe to call
   *  in render. */
  paneVisibility: (paneId: string): ReadableAtom<boolean> => $paneVisible(paneId),

  /** Open a URL with the platform door (new tab on the web). */
  openExternal: (url: string): void => {
    void window.hermesDesktop?.openExternal(url)
  },

  /** Restart the backend gateway (progress surfaces in the core statusbar). */
  restartGateway: async () => runGatewayRestart(),

  /** One-shot system status snapshot (platforms, versions, …). */
  status: async () => getStatus(),

  /** Gateway JSON-RPC — sessions, config, skills, cron, everything the app
   *  itself uses. Lazy: resolves the LIVE socket per call. */
  request: async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const gateway = $gateway.get()

    if (!gateway) {
      throw new Error('Hermes gateway unavailable')
    }

    return gateway.request<T>(method, params)
  },

  /** The LIVE gateway instance for the active profile (null before the first
   *  socket opens). Most plugins want `host.request`; this exists for SDK
   *  components that take a `HermesGateway` prop directly. Re-read per use —
   *  the active instance changes on a profile swap. */
  getGateway: (): HermesGateway | null => $gateway.get()
}

// -- contribution areas -------------------------------------------------------

export {
  COMPOSER_AREAS,
  type ComposerAtCompletionItem,
  type ComposerAtCompletionSource,
  type ComposerAttachmentProvider,
  type ComposerMiddleware
} from '@/app/chat/composer/contrib'
export { PALETTE_AREA, type PaletteContribution } from '@/app/command-palette/contrib'
export { PANES_AREA }

// -- ui: the design language --------------------------------------------------

export { StatusDot, type StatusTone } from '@/components/status-dot'
export { Badge } from '@/components/ui/badge'
export { Button } from '@/components/ui/button'
export { Checkbox } from '@/components/ui/checkbox'
export { Codicon } from '@/components/ui/codicon'
export { ConfirmDialog } from '@/components/ui/confirm-dialog'
export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
export { CopyButton } from '@/components/ui/copy-button'
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
export { EmptyState } from '@/components/ui/empty-state'
export { ErrorState } from '@/components/ui/error-state'
export { GlyphSpinner } from '@/components/ui/glyph-spinner'
export { Input } from '@/components/ui/input'
export { Kbd, KbdGroup } from '@/components/ui/kbd'
export { Loader, type LoaderType } from '@/components/ui/loader'
export { LogView } from '@/components/ui/log-view'
export { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
export { ScrollArea } from '@/components/ui/scroll-area'
export { SearchField } from '@/components/ui/search-field'
export { SegmentedControl } from '@/components/ui/segmented-control'
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
export { Separator } from '@/components/ui/separator'
export { Skeleton } from '@/components/ui/skeleton'
export { Switch } from '@/components/ui/switch'
export { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
export { Textarea } from '@/components/ui/textarea'
export { Tip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// -- contracts ----------------------------------------------------------------

export type {
  HermesPlugin,
  PluginContext,
  PluginContribution,
  PluginNativeNotificationInput,
  PluginOs,
  PluginRestOptions,
  PluginStorage
} from '@/contrib/plugin'
/** Mount-scoped contribution: while the rendering component is mounted, its
 *  children render in the target area's slot; unmount disposes it. */
export { Contribute, type ContributeProps } from '@/contrib/react/contribute'
export type { Contribution } from '@/contrib/types'
/** The live gateway instance type — obtain the instance from
 *  `host.getGateway()`. */
export type { HermesGateway } from '@/hermes'
export {
  type Locale,
  type PluginI18n,
  type PluginLocaleBundles,
  type PluginMessages,
  type PluginMessageValue,
  type PluginTranslate,
  useI18n,
  usePluginI18n
} from '@/i18n'
/** THE way to run a decorative rAF animation (avatars, shimmer, sprites):
 *  fps budget + hidden/unfocused pause + idle dormancy + teardown. */
export { type BudgetedLoop, type BudgetedLoopOptions, createBudgetedLoop } from '@/lib/budgeted-loop'
/** THE compact-number formatter — every user-facing count/token figure goes
 *  through here (1230 → "1.2k"). */
export { compactNumber } from '@/lib/format'
export { triggerHaptic as haptic } from '@/lib/haptics'
/** The app's icon set. */
export * as icons from '@/lib/icons'
/** The app's deterministic identity color for a name (profiles, assignees,
 *  authors) — so plugin-rendered identities read the same hue as everywhere
 *  else. */
export { profileColor, profileColorSoft } from '@/lib/profile-color'
/** The shared client itself, for invalidation OUTSIDE React. Inside
 *  components keep using `useQueryClient`. */
export { queryClient } from '@/lib/query-client'
/** The app's own gateway-readiness evaluation — pass `host.request`. */
export { evaluateRuntimeReadiness, type RuntimeReadinessResult } from '@/lib/runtime-readiness'
export { coarseElapsed, fmtDateTime, fmtDayTime, relativeTime } from '@/lib/time'
export { cn } from '@/lib/utils'
export type { RpcEvent, StatusResponse } from '@/types/hermes'
/** Subscribe a component to a `host.state` atom. */
export { useStore as useValue } from '@nanostores/react'
/** The app's data-fetching layer. Plugins share the ONE QueryClient mounted at
 *  the app root, so their queries cache, dedupe, poll, and invalidate exactly
 *  like core screens. */
export { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
/** Plugin-local reactive state — the same primitive `host.state` uses. */
export { atom, computed } from 'nanostores'
/** Markdown renderer (same pipeline core chat surfaces use). */
export { Streamdown } from 'streamdown'
