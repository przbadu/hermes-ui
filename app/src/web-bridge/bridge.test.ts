import { describe, expect, it } from 'vitest'

import { connectionModeForGatewayUrl } from './bridge'

describe('connectionModeForGatewayUrl', () => {
  it('treats the default and serving-origin gateways as local', () => {
    expect(connectionModeForGatewayUrl('')).toBe('local')
    expect(connectionModeForGatewayUrl(window.location.origin)).toBe('local')
  })

  it('keeps a distinct backend origin remote', () => {
    expect(connectionModeForGatewayUrl('https://hermes.example.test:9119')).toBe('remote')
  })
})
