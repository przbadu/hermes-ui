import { afterEach, describe, expect, it, vi } from 'vitest'

import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { CHAT_SIDEBAR_PANE_ID } from '@/store/layout'

import { dismissMobileChatSidebar } from './mobile-pane-navigation'

describe('dismissMobileChatSidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('closes the Sessions/Bots reveal drawer on a narrow viewport', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }) as MediaQueryList)
    )
    const listener = vi.fn()

    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)
    dismissMobileChatSidebar()
    window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      id: CHAT_SIDEBAR_PANE_ID,
      mode: 'close'
    })
  })

  it('leaves the docked desktop sidebar open', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }) as MediaQueryList)
    )
    const listener = vi.fn()

    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)
    dismissMobileChatSidebar()
    window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)

    expect(listener).not.toHaveBeenCalled()
  })
})
