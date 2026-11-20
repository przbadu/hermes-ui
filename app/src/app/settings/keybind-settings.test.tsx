import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $bindings, resetAllBindings, setBinding } from '@/store/keybinds'

import { KeybindSettings } from './keybind-settings'

const STORAGE_KEY = 'hermes.desktop.keybinds'

function rowFor(label: string): HTMLElement {
  // The label <p> sits inside the row's text cell; its grandparent is the row.
  const node = screen.getByText(label)

  return node.parentElement?.parentElement as HTMLElement
}

beforeEach(() => {
  localStorage.clear()
  resetAllBindings()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('KeybindSettings', () => {
  it('lists rebindable actions grouped by category', () => {
    render(<KeybindSettings />)

    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy()
    expect(screen.getByText('Composer')).toBeTruthy()
    expect(screen.getByText('Profiles')).toBeTruthy()
    expect(screen.getAllByText('Rebind').length).toBeGreaterThan(1)
  })

  it('captures the next chord and persists it as a custom binding', async () => {
    render(<KeybindSettings />)

    fireEvent.click(within(rowFor('Focus composer')).getByText('Rebind'))
    expect(screen.getByText('Press a key…')).toBeTruthy()

    fireEvent.keyDown(window, { code: 'KeyK', ctrlKey: true, key: 'k' })

    await waitFor(() => expect($bindings.get()['composer.focus']).toEqual(['mod+k']))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')['composer.focus']).toEqual(['mod+k'])
  })

  it('flags a chord that is already bound to another action', async () => {
    render(<KeybindSettings />)

    fireEvent.click(within(rowFor('Focus composer')).getByText('Rebind'))
    // mod+k is the shipped default for "Open command palette".
    fireEvent.keyDown(window, { code: 'KeyK', ctrlKey: true, key: 'k' })

    await waitFor(() => expect(screen.getAllByText(/Also bound to/).length).toBeGreaterThan(0))
  })

  it('resets a custom binding back to its default', async () => {
    setBinding('composer.focus', ['mod+k'])
    render(<KeybindSettings />)

    const reset = within(rowFor('Focus composer')).getByRole('button', { name: 'Reset to default' })
    fireEvent.click(reset)

    await waitFor(() => expect($bindings.get()['composer.focus']).toEqual([]))
  })
})
