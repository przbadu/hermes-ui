import { afterEach, describe, expect, it } from 'vitest'

import { classifyGatewayReach } from './gateways'

// jsdom serves these tests from http://localhost:3000, so the app origin is
// loopback - the case that lets it reach other loopback gateways for free, and
// against which the whitelist opts in non-loopback gateways.

describe('classifyGatewayReach', () => {
  afterEach(() => {
    delete window.__HERMES_GATEWAY_WHITELIST__
  })

  it('allows the serving origin itself', () => {
    expect(classifyGatewayReach('')).toBeNull()
    expect(classifyGatewayReach('http://localhost:3000')).toBeNull()
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

  it('allows a non-loopback gateway once it is whitelisted (compared by origin)', () => {
    window.__HERMES_GATEWAY_WHITELIST__ = ['http://203.0.113.10:9119', 'https://hermes.example.com/']

    expect(classifyGatewayReach('http://203.0.113.10:9119')).toBeNull()
    // Trailing path on the entered URL still matches by origin.
    expect(classifyGatewayReach('https://hermes.example.com/dashboard')).toBeNull()
    // A different port is a different origin and stays blocked.
    expect(classifyGatewayReach('http://203.0.113.10:9200')).toBe('cross-origin')
  })
})
