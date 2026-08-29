import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $paneStates } from '@/store/panes'

import { Pane, PaneMain, paneRevealActionForSwipe, PaneShell } from './pane-shell'

beforeEach(() => {
  $paneStates.set({})
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  $paneStates.set({})
  window.localStorage.clear()
})

describe('pane reveal swipe direction', () => {
  it('opens each edge by swiping inward', () => {
    expect(paneRevealActionForSwipe('left', false, 60, 4)).toBe('open')
    expect(paneRevealActionForSwipe('right', false, -60, 4)).toBe('open')
  })

  it('closes each open pane by swiping outward', () => {
    expect(paneRevealActionForSwipe('left', true, -60, 4)).toBe('close')
    expect(paneRevealActionForSwipe('right', true, 60, 4)).toBe('close')
  })

  it('ignores short, vertical, and backwards opening gestures', () => {
    expect(paneRevealActionForSwipe('left', false, 30, 0)).toBeNull()
    expect(paneRevealActionForSwipe('left', false, 50, 80)).toBeNull()
    expect(paneRevealActionForSwipe('left', false, -60, 0)).toBeNull()
  })
})

it('opens from an inward touch swipe and closes from an outward swipe', () => {
  const rendered = render(
    <PaneShell>
      <Pane forceCollapsed hoverReveal id="sessions" side="left" swipeReveal width="240px">
        sessions
      </Pane>
      <PaneMain>main</PaneMain>
    </PaneShell>
  )

  const root = rendered.container.querySelector('[data-pane-id="sessions"]')
  const trigger = root?.querySelector('[data-pane-reveal-trigger]')

  expect(root).toBeInstanceOf(HTMLElement)
  expect(trigger).toBeInstanceOf(HTMLElement)

  Object.defineProperties(trigger!, {
    releasePointerCapture: { configurable: true, value: vi.fn() },
    setPointerCapture: { configurable: true, value: vi.fn() }
  })
  fireEvent.pointerDown(trigger!, { clientX: 4, clientY: 200, pointerId: 1, pointerType: 'touch' })
  fireEvent.pointerUp(trigger!, { clientX: 70, clientY: 202, pointerId: 1, pointerType: 'touch' })

  expect(root?.getAttribute('data-pane-hover-reveal')).toBe('open')

  const panel = root?.children[1]

  expect(panel).toBeInstanceOf(HTMLElement)
  Object.defineProperties(panel!, {
    releasePointerCapture: { configurable: true, value: vi.fn() },
    setPointerCapture: { configurable: true, value: vi.fn() }
  })
  fireEvent.pointerDown(panel!, { clientX: 180, clientY: 200, pointerId: 2, pointerType: 'touch' })
  fireEvent.pointerUp(panel!, { clientX: 100, clientY: 202, pointerId: 2, pointerType: 'touch' })

  expect(root?.getAttribute('data-pane-hover-reveal')).toBe('closed')
})
