import { $profileScope } from '@/store/profile'
import {
  $sessionProfileTotals,
  $sessions,
  $sessionsTotal,
  setSessionProfileTotals,
  setSessions,
  setSessionsTotal
} from '@/store/session'
import type { SessionInfo } from '@/types/hermes'
import { getActiveGateway } from '@/web-bridge/gateways'

// Persist the sidebar's recents list so a cold boot can paint real rows the
// instant React mounts, then revalidate — instead of an empty list behind the
// connecting overlay for a couple of seconds on every refresh / gateway switch.
//
// Isolation is the whole ballgame here:
//   • Every entry is keyed on (active gateway origin, profile scope), so one
//     gateway's or profile's sessions can NEVER surface under another.
//   • Hydration only ever SEEDS an empty list — it never overwrites data the
//     running app has already fetched this session, so a stale snapshot can't
//     mask live truth.
//   • Only session metadata already returned by the list endpoint is stored;
//     no tokens, no auth, no live-stream state.
// Everything is best-effort inside try/catch, so a missing / unreadable / quota-
// exceeded snapshot degrades to exactly the pre-cache behavior (empty list).
const KEY_PREFIX = 'hermes-sidebar-cache:'

// Bumped when the stored shape changes so an older build's entry is ignored
// rather than mis-rendered.
const SCHEMA_VERSION = 1

// Cap persisted rows per entry (the sidebar only shows a page anyway) and the
// number of distinct (gateway, profile) entries, so the cache stays well within
// localStorage's budget and old contexts are pruned.
const MAX_ROWS = 60
const MAX_ENTRIES = 12

interface SidebarSnapshot {
  v: number
  ts: number
  sessions: SessionInfo[]
  total: number
  profileTotals: Record<string, number>
}

// Stable, tidy key fragment for a string (djb2). Not for security — the data is
// the user's own, on their own device — just to keep the localStorage key short
// and free of odd URL characters.
function hash(input: string): string {
  let h = 5381

  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }

  return h.toString(36)
}

// Origin of the active gateway — the per-gateway isolation dimension. Falls back
// to the raw configured URL, then a constant, so a malformed URL still yields a
// deterministic (and still gateway-specific) key.
function originKey(): string {
  const url = getActiveGateway().url || ''

  try {
    return new URL(url).origin
  } catch {
    return url || 'default-gateway'
  }
}

function cacheKey(profileScope: string): string {
  return `${KEY_PREFIX}${hash(originKey())}:${profileScope}`
}

// Evict the oldest entries once we exceed MAX_ENTRIES, so the cache can't grow
// without bound as gateways/profiles come and go.
function pruneEntries(): void {
  try {
    const entries: { key: string; ts: number }[] = []

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)

      if (!key || !key.startsWith(KEY_PREFIX)) {
        continue
      }

      let ts = 0

      try {
        ts = (JSON.parse(window.localStorage.getItem(key) ?? '{}') as SidebarSnapshot).ts || 0
      } catch {
        // Unparseable entry — treat as oldest so it's the first to go.
      }

      entries.push({ key, ts })
    }

    if (entries.length <= MAX_ENTRIES) {
      return
    }

    entries
      .sort((a, b) => a.ts - b.ts)
      .slice(0, entries.length - MAX_ENTRIES)
      .forEach(entry => window.localStorage.removeItem(entry.key))
  } catch {
    // Non-fatal: pruning is opportunistic.
  }
}

// Seed the recents list from the snapshot for the CURRENT (gateway, profile),
// but only when the list is empty — so this can only ever fill a blank sidebar,
// never overwrite rows the app has already loaded.
export function hydrateSidebarCache(): void {
  if (typeof window === 'undefined' || $sessions.get().length > 0) {
    return
  }

  try {
    const raw = window.localStorage.getItem(cacheKey($profileScope.get()))

    if (!raw) {
      return
    }

    const snap = JSON.parse(raw) as SidebarSnapshot

    if (!snap || snap.v !== SCHEMA_VERSION || !Array.isArray(snap.sessions) || snap.sessions.length === 0) {
      return
    }

    setSessions(snap.sessions)
    setSessionsTotal(typeof snap.total === 'number' ? snap.total : snap.sessions.length)
    setSessionProfileTotals(snap.profileTotals ?? {})
  } catch {
    // Ignore — an empty list is a safe fallback.
  }
}

// Persist the current recents list under the given profile scope's key. The
// scope is passed by the caller (captured at fetch time) rather than read live,
// so a profile switch mid-refresh can't file one profile's rows under another's
// key.
export function writeSidebarCache(profileScope: string): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const sessions = $sessions.get()

    if (sessions.length === 0) {
      return
    }

    const snapshot: SidebarSnapshot = {
      v: SCHEMA_VERSION,
      ts: Date.now(),
      sessions: sessions.slice(0, MAX_ROWS),
      total: $sessionsTotal.get(),
      profileTotals: $sessionProfileTotals.get()
    }

    window.localStorage.setItem(cacheKey(profileScope), JSON.stringify(snapshot))
    pruneEntries()
  } catch {
    // Storage unavailable / quota exceeded — skip silently.
  }
}

// Hydrate once at boot, then re-seed if the profile scope resolves to a
// non-default context during boot before the first refresh lands. The empty-list
// guard in hydrateSidebarCache keeps this from ever clobbering live data, so a
// runtime profile switch (which leaves the previous rows in place) is untouched.
export function initSidebarCache(): void {
  if (typeof window === 'undefined') {
    return
  }

  $profileScope.subscribe(() => hydrateSidebarCache())
}
