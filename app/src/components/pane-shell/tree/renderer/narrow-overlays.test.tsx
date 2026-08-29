import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { registry } from '@/contrib/registry'

import { group, split } from '../model'
import { $layoutTree, $narrowViewport } from '../store'

import { narrowOverlayActionForSwipe, NarrowOverlays } from './narrow-overlays'

const disposers: (() => void)[] = []

function registerPane(id: string, title: string, data: Record<string, unknown>, body: string) {
  disposers.push(
    registry.register({
      area: 'panes',
      data,
      id,
      render: () => <div data-testid={`${id}-body`}>{body}</div>,
      title
    })
  )
}

beforeEach(() => {
  registerPane(
    'sessions',
    'Sessions',
    { collapsible: true, placement: 'left', revealAliases: ['chat-sidebar'], width: '237px' },
    'session rows'
  )
  registerPane('bots', 'Bots', { collapsible: true, placement: 'left', width: '260px' }, 'bot roster')
  registerPane('workspace', 'Chat', { placement: 'main', uncloseable: true }, 'chat')
  $layoutTree.set(split('row', [group(['sessions', 'bots']), group(['workspace'])]))
  $narrowViewport.set(true)
})

afterEach(() => {
  cleanup()
  $narrowViewport.set(false)
  $layoutTree.set(null)
  disposers.splice(0).forEach(dispose => dispose())
})

function revealPane(id: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id, mode: 'open' } }))
  })
}

describe('NarrowOverlays', () => {
  it('mirrors the Sessions/Bots strip and dismisses when the conversation backdrop is tapped', () => {
    const { getByLabelText, getByTestId, queryByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')
    expect(getByTestId('sessions-body')).toBeTruthy()
    expect(document.querySelector('[data-narrow-overlay-tab="bots"]')).toBeTruthy()

    fireEvent.pointerDown(document.querySelector('[data-narrow-overlay-tab="bots"]')!, { button: 0 })
    expect(getByTestId('bots-body')).toBeTruthy()
    expect(queryByTestId('sessions-body')).toBeNull()

    fireEvent.click(getByLabelText('Close side menu'))
    expect(queryByTestId('bots-body')).toBeNull()
  })

  it('dismisses the whole Sessions/Bots drawer when navigation closes its alias', () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')
    fireEvent.pointerDown(document.querySelector('[data-narrow-overlay-tab="bots"]')!, { button: 0 })
    expect(getByTestId('bots-body')).toBeTruthy()

    act(() => {
      window.dispatchEvent(
        new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'chat-sidebar', mode: 'close' } })
      )
    })

    expect(queryByTestId('bots-body')).toBeNull()
  })

  it('places a Desktop-tiled pane in the requested phone drawer', () => {
    registerPane(
      'cronjobs',
      'Cronjobs',
      { narrowCollapsible: true, narrowSide: 'right', placement: 'main', width: '250px' },
      'scheduled jobs'
    )
    $layoutTree.set(split('row', [group(['workspace']), group(['cronjobs'])]))

    const { getByTestId } = render(<NarrowOverlays />)

    revealPane('cronjobs')
    expect(getByTestId('cronjobs-body').closest('[data-glass-opaque]')?.className).toContain('right-0')
  })
})

describe('narrowOverlayActionForSwipe', () => {
  it('opens inward and closes outward from both edges', () => {
    expect(narrowOverlayActionForSwipe('left', false, 60, 3)).toBe('open')
    expect(narrowOverlayActionForSwipe('left', true, -60, 3)).toBe('close')
    expect(narrowOverlayActionForSwipe('right', false, -60, 3)).toBe('open')
    expect(narrowOverlayActionForSwipe('right', true, 60, 3)).toBe('close')
  })

  it('ignores short and mostly vertical gestures', () => {
    expect(narrowOverlayActionForSwipe('left', false, 30, 0)).toBeNull()
    expect(narrowOverlayActionForSwipe('right', false, -60, 80)).toBeNull()
  })
})
