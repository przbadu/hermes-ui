import { dehydrate, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Controllable gateway origin (the per-gateway key dimension).
let activeUrl = 'http://127.0.0.1:9119'

vi.mock('@/web-bridge/gateways', () => ({ getActiveGateway: () => ({ url: activeUrl }) }))

// A real QueryClient the module persists from / hydrates into.
const queryClient = new QueryClient()

vi.mock('./query-client', () => ({ queryClient }))

const { hydratePersistedQueries, initQueryPersistence } = await import('./query-persist')

// Mirror the module's buster + key derivation so tests can seed blobs directly.
// Vitest loads vite.config.ts, so __HERMES_BUILD_ID__ is injected here too and
// matches the value baked into the module under test.
const BUSTER = `1:${typeof __HERMES_BUILD_ID__ === 'string' ? __HERMES_BUILD_ID__ : 'dev'}`

function djb2(input: string): string {
  let h = 5381

  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }

  return h.toString(36)
}

// Write a valid envelope (real dehydrated state) for a given gateway origin.
function seedBlob(origin: string, buster: string, configData: unknown): void {
  const temp = new QueryClient()
  temp.setQueryData(['hermes-config-record'], configData)
  const state = dehydrate(temp, { shouldDehydrateQuery: () => true })
  localStorage.setItem(`hermes-rq-cache:${djb2(origin)}`, JSON.stringify({ buster, state }))
}

function persistedEntry(): { key: string; queryKeys: string[] } | null {
  const key = Object.keys(localStorage).find(k => k.startsWith('hermes-rq-cache:'))

  if (!key) {
    return null
  }

  const env = JSON.parse(localStorage.getItem(key) ?? '{}')

  return { key, queryKeys: (env.state?.queries ?? []).map((q: { queryKey: unknown }) => JSON.stringify(q.queryKey)) }
}

beforeEach(() => {
  localStorage.clear()
  queryClient.clear()
  activeUrl = 'http://127.0.0.1:9119'
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('query-persist', () => {
  it('persists only allowlisted, read-only queries', () => {
    // Allowlisted:
    queryClient.setQueryData(['hermes-config-record'], { ok: true })
    queryClient.setQueryData(['hermes-config-schema'], { v: 1 })
    queryClient.setQueryData(['skills-list'], [])
    queryClient.setQueryData(['toolsets-list'], [])
    queryClient.setQueryData(['mcp-catalog', 'default'], [])
    queryClient.setQueryData(['command-palette', 'config'], { a: 1 })
    // Must NEVER be persisted (live / auth / search):
    queryClient.setQueryData(['model-options', 's1'], { token: 'secret' })
    queryClient.setQueryData(['command-palette', 'sessions'], [1, 2])
    queryClient.setQueryData(['command-palette', 'archived'], [3])
    queryClient.setQueryData(['session-picker', 'sessions'], [4])

    initQueryPersistence()
    // Trigger a cache event so the debounced write-through fires.
    queryClient.setQueryData(['hermes-config-record'], { ok: true, n: 2 })
    vi.advanceTimersByTime(300)

    const entry = persistedEntry()
    expect(entry).not.toBeNull()

    const keys = new Set(entry!.queryKeys)
    expect(keys).toContain('["hermes-config-record"]')
    expect(keys).toContain('["hermes-config-schema"]')
    expect(keys).toContain('["skills-list"]')
    expect(keys).toContain('["toolsets-list"]')
    expect(keys).toContain('["mcp-catalog","default"]')
    expect(keys).toContain('["command-palette","config"]')

    // The critical exclusions:
    expect([...keys].some(k => k.includes('model-options'))).toBe(false)
    expect(keys).not.toContain('["command-palette","sessions"]')
    expect(keys).not.toContain('["command-palette","archived"]')
    expect([...keys].some(k => k.includes('session-picker'))).toBe(false)
  })

  it('hydrates a matching snapshot back into the cache', () => {
    seedBlob('http://127.0.0.1:9119', BUSTER, { config: 42 })

    hydratePersistedQueries()

    expect(queryClient.getQueryData(['hermes-config-record'])).toEqual({ config: 42 })
  })

  it('ignores a snapshot whose buster does not match (drops stale on redeploy)', () => {
    seedBlob('http://127.0.0.1:9119', 'STALE-BUSTER', { config: 42 })

    hydratePersistedQueries()

    expect(queryClient.getQueryData(['hermes-config-record'])).toBeUndefined()
  })

  it('does not hydrate one gateway’s blob under another', () => {
    // Blob written for a DIFFERENT gateway origin than the active one.
    seedBlob('http://127.0.0.1:9200', BUSTER, { config: 42 })

    hydratePersistedQueries()

    expect(queryClient.getQueryData(['hermes-config-record'])).toBeUndefined()
  })
})
