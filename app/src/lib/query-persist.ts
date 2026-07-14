import { dehydrate, hydrate, type Query } from '@tanstack/react-query'

import { getActiveGateway } from '@/web-bridge/gateways'

import { queryClient } from './query-client'

// Persist a tight allowlist of read-only React Query results to localStorage so
// settings-ish panels (config, skills, toolsets, MCP catalog) render instantly
// from cache on a cold boot, then revalidate — instead of spinning while the
// first fetch round-trips. This is the React Query analogue of the sidebar
// nanostore cache; sessions are handled there, not here.
//
// Safety rules, same spirit as the sidebar cache:
//   • Opt-IN allowlist only — auth, status, model-options and every live query
//     are never written to disk.
//   • The blob is keyed on the active gateway origin, so one gateway's config
//     can't hydrate under another.
//   • A build-id buster drops the whole blob whenever the app is redeployed (or
//     the dev server restarts), so a data-shape change can't render stale-broken.
//   • Everything is best-effort inside try/catch — absent/quota-exceeded storage
//     degrades to exactly the pre-cache (fetch-then-show) behavior.
const KEY_PREFIX = 'hermes-rq-cache:'

// Bumped by hand when the persisted envelope shape changes. Combined with the
// per-build id below so both a manual bump and any redeploy invalidate.
const SCHEMA_VERSION = 1

// Injected by Vite (define) at build time; falls back to 'dev' when absent.
declare const __HERMES_BUILD_ID__: string

const BUSTER = `${SCHEMA_VERSION}:${typeof __HERMES_BUILD_ID__ === 'string' ? __HERMES_BUILD_ID__ : 'dev'}`

interface Envelope {
  buster: string
  state: ReturnType<typeof dehydrate>
}

// Only these query keys are ever written to disk. Everything else — live
// sessions, model options, auth/status, search results — is excluded by
// default. `command-palette` is allowed only for its static 'config' entry, not
// its live 'sessions' / 'archived' lists.
function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== 'success') {
    return false
  }

  const [head, sub] = query.queryKey as readonly unknown[]

  switch (head) {
    case 'hermes-config-record':

    case 'hermes-config-schema':

    case 'mcp-catalog':

    case 'skills-list':

    case 'toolsets-list':
      return true

    case 'command-palette':
      return sub === 'config'

    default:
      return false
  }
}

// djb2 — a short, stable key fragment for the gateway origin (see sidebar-cache
// for the same rationale: not security, just a tidy key).
function hash(input: string): string {
  let h = 5381

  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }

  return h.toString(36)
}

function originKey(): string {
  const url = getActiveGateway().url || ''

  try {
    return new URL(url).origin
  } catch {
    return url || 'default-gateway'
  }
}

function storageKey(): string {
  return `${KEY_PREFIX}${hash(originKey())}`
}

// Seed the query cache from the current gateway's persisted blob. Safe to call
// before the first render: hydrate() only fills entries that aren't already
// present, and every persisted query is stale-on-mount (staleTime 0 / 60s) so it
// refetches immediately.
export function hydratePersistedQueries(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const raw = window.localStorage.getItem(storageKey())

    if (!raw) {
      return
    }

    const envelope = JSON.parse(raw) as Envelope

    if (!envelope || envelope.buster !== BUSTER || !envelope.state) {
      return
    }

    hydrate(queryClient, envelope.state)
  } catch {
    // Ignore — a cold fetch is the safe fallback.
  }
}

let scheduled = false

function flush(): void {
  scheduled = false

  try {
    const state = dehydrate(queryClient, { shouldDehydrateQuery: shouldPersistQuery })
    const envelope: Envelope = { buster: BUSTER, state }

    window.localStorage.setItem(storageKey(), JSON.stringify(envelope))
  } catch {
    // Storage unavailable / quota exceeded — skip silently.
  }
}

function schedule(): void {
  if (scheduled || typeof window === 'undefined') {
    return
  }

  scheduled = true
  // Coalesce bursts of cache events (a settings page mounting fires several) into
  // one write. setTimeout rather than rAF so it still flushes in a backgrounded
  // tab.
  window.setTimeout(flush, 250)
}

// Hydrate once, then write-through on every cache change (allowlisted only).
// Call before createRoot so the hydrate lands before the first render.
export function initQueryPersistence(): void {
  if (typeof window === 'undefined') {
    return
  }

  hydratePersistedQueries()
  queryClient.getQueryCache().subscribe(schedule)
}
