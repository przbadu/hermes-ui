import { atom } from 'nanostores'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

// Control the active gateway URL (the per-gateway isolation dimension) per test.
let activeUrl = 'http://127.0.0.1:9119'

vi.mock('@/web-bridge/gateways', () => ({
  getActiveGateway: () => ({ url: activeUrl })
}))

// Controllable profile scope + session atoms, so the cache logic is exercised
// in isolation from profile.ts / session.ts side-effecting imports.
const $profileScope = atom<string>('default')

vi.mock('@/store/profile', () => ({ $profileScope }))

const $sessions = atom<SessionInfo[]>([])
const $sessionsTotal = atom<number>(0)
const $sessionProfileTotals = atom<Record<string, number>>({})

vi.mock('@/store/session', () => ({
  $sessionProfileTotals,
  $sessions,
  $sessionsTotal,
  setSessionProfileTotals: (v: Record<string, number>) => $sessionProfileTotals.set(v),
  setSessions: (v: SessionInfo[]) => $sessions.set(v),
  setSessionsTotal: (v: number) => $sessionsTotal.set(v)
}))

const { hydrateSidebarCache, writeSidebarCache } = await import('./sidebar-cache')

const session = (id: string): SessionInfo =>
  ({
    ended_at: null,
    id,
    input_tokens: 0,
    is_active: false,
    last_active: 0,
    message_count: 1,
    model: null,
    output_tokens: 0,
    preview: null,
    source: 'desktop',
    started_at: 0,
    title: `session ${id}`,
    tool_call_count: 0
  }) as SessionInfo

beforeEach(() => {
  localStorage.clear()
  activeUrl = 'http://127.0.0.1:9119'
  $profileScope.set('default')
  $sessions.set([])
  $sessionsTotal.set(0)
  $sessionProfileTotals.set({})
})

describe('sidebar-cache', () => {
  it('round-trips the recents list for the same gateway + profile', () => {
    $sessions.set([session('a'), session('b')])
    $sessionsTotal.set(9)
    $sessionProfileTotals.set({ default: 9 })
    writeSidebarCache('default')

    // Simulate a fresh boot: empty stores, then hydrate.
    $sessions.set([])
    $sessionsTotal.set(0)
    $sessionProfileTotals.set({})
    hydrateSidebarCache()

    expect($sessions.get().map(s => s.id)).toEqual(['a', 'b'])
    expect($sessionsTotal.get()).toBe(9)
    expect($sessionProfileTotals.get()).toEqual({ default: 9 })
  })

  it('never overwrites a non-empty list (stale cache cannot mask live data)', () => {
    $sessions.set([session('cached')])
    writeSidebarCache('default')

    $sessions.set([session('live')])
    hydrateSidebarCache()

    expect($sessions.get().map(s => s.id)).toEqual(['live'])
  })

  it('does not leak one gateway’s sessions into another', () => {
    $sessions.set([session('gatewayA')])
    writeSidebarCache('default')

    // Switch to a different gateway origin and boot fresh.
    activeUrl = 'http://127.0.0.1:9200'
    $sessions.set([])
    hydrateSidebarCache()

    expect($sessions.get()).toEqual([])
  })

  it('does not leak one profile’s sessions into another', () => {
    $profileScope.set('work')
    $sessions.set([session('work-1')])
    writeSidebarCache('work')

    // Same gateway, different profile scope, fresh boot.
    $profileScope.set('default')
    $sessions.set([])
    hydrateSidebarCache()

    expect($sessions.get()).toEqual([])
  })

  it('caps the persisted rows', () => {
    $sessions.set(Array.from({ length: 200 }, (_, i) => session(`s${i}`)))
    writeSidebarCache('default')

    $sessions.set([])
    hydrateSidebarCache()

    expect($sessions.get().length).toBe(60)
  })

  it('is a no-op when there is no snapshot', () => {
    hydrateSidebarCache()
    expect($sessions.get()).toEqual([])
  })
})
