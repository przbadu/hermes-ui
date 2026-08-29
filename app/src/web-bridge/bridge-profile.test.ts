import { describe, expect, it } from 'vitest'

import { withApiProfile } from './bridge'

describe('withApiProfile', () => {
  it('adds a missing profile query', () => {
    expect(withApiProfile('/api/sessions/chat', 'lab manager')).toBe('/api/sessions/chat?profile=lab%20manager')
  })

  it('replaces an existing profile instead of duplicating it', () => {
    const url = withApiProfile('/api/sessions/chat?archived=false&profile=default', 'labmanager')

    expect(url).toBe('/api/sessions/chat?archived=false&profile=labmanager')
    expect(url.match(/profile=/g)).toHaveLength(1)
  })
})
