import { afterEach, describe, expect, it } from 'vitest'

import { classifyGatewayReach, upstreamOriginFor, withGatewayRoute } from './gateways'

// jsdom serves these tests from http://localhost:3000, so the app origin is
// loopback. A whitelisted gateway is folded to the serving origin by the dev
// proxy, so it reads as same-origin here.

const HOST = 'http://localhost:3000'

afterEach(() => {
  delete window.__HERMES_GATEWAY_WHITELIST__
})

describe('classifyGatewayReach', () => {
  it('allows the serving origin itself', () => {
    expect(classifyGatewayReach('')).toBeNull()
    expect(classifyGatewayReach(HOST)).toBeNull()
  })

  it('allows any loopback gateway with no configuration (only the port differs)', () => {
    expect(classifyGatewayReach('http://127.0.0.1:9200')).toBeNull()
    expect(classifyGatewayReach('http://localhost:9119')).toBeNull()
    expect(classifyGatewayReach('http://sub.localhost:9300')).toBeNull()
  })

  it('blocks a non-loopback gateway that is not whitelisted', () => {
    expect(classifyGatewayReach('https://hermes.example.com')).toBe('cross-origin')
    expect(classifyGatewayReach('http://203.0.113.10:9119')).toBe('cross-origin')
  })

  it('allows a whitelisted gateway (folded through the dev proxy to same-origin)', () => {
    window.__HERMES_GATEWAY_WHITELIST__ = ['https://hermes.example.com', 'http://203.0.113.10:9119']

    expect(classifyGatewayReach('https://hermes.example.com')).toBeNull()
    expect(classifyGatewayReach('https://hermes.example.com/dashboard')).toBeNull()
    expect(classifyGatewayReach('http://203.0.113.10:9119')).toBeNull()
    // A different port is a different origin and stays blocked.
    expect(classifyGatewayReach('http://203.0.113.10:9200')).toBe('cross-origin')
  })
})

describe('upstreamOriginFor', () => {
  it('returns the origin only for an absolute whitelisted URL', () => {
    window.__HERMES_GATEWAY_WHITELIST__ = ['https://hermes.example.com']

    expect(upstreamOriginFor('https://hermes.example.com')).toBe('https://hermes.example.com')
    expect(upstreamOriginFor('https://hermes.example.com/x')).toBe('https://hermes.example.com')
    // Not whitelisted.
    expect(upstreamOriginFor('https://other.example.com')).toBeNull()
    // The default and /prefix gateways have no distinct upstream.
    expect(upstreamOriginFor('')).toBeNull()
    expect(upstreamOriginFor('/hermes')).toBeNull()
  })

  it('returns null with no whitelist (production build)', () => {
    expect(upstreamOriginFor('https://hermes.example.com')).toBeNull()
  })
})

describe('withGatewayRoute', () => {
  it('stamps ?__hgw for a whitelisted upstream origin', () => {
    window.__HERMES_GATEWAY_WHITELIST__ = ['https://hermes.example.com']

    const url = withGatewayRoute(`${HOST}/api/status`, 'https://hermes.example.com')

    expect(new URL(url).searchParams.get('__hgw')).toBe('https://hermes.example.com')
  })

  it('is a no-op with no origin, or in production (no whitelist)', () => {
    window.__HERMES_GATEWAY_WHITELIST__ = ['https://hermes.example.com']
    expect(withGatewayRoute(`${HOST}/api/status`, null)).toBe(`${HOST}/api/status`)

    delete window.__HERMES_GATEWAY_WHITELIST__
    expect(withGatewayRoute(`${HOST}/api/status`, 'https://hermes.example.com')).toBe(`${HOST}/api/status`)
  })
})
