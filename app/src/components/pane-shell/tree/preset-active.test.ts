import { atom } from 'nanostores'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('layout preset active pane', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('keeps Focus on workspace after turning its terminal backing store on', async () => {
    const model = await import('./model')
    const tree = await import('./store')
    const { registry } = await import('@/contrib/registry')
    const terminalOpen = atom(false)

    registry.registerMany([
      { area: 'panes', data: { placement: 'main', uncloseable: true }, id: 'workspace', render: () => null },
      {
        area: 'panes',
        data: { placement: 'bottom', revealOnPreset: true },
        id: 'terminal',
        render: () => null
      }
    ])

    const focus = model.group(['workspace', 'terminal'], { active: 'workspace', id: 'focus-group' })
    tree.declareDefaultTree(focus)
    tree.bindToolPaneCollapse(
      'terminal',
      terminalOpen,
      () => terminalOpen.set(false),
      () => terminalOpen.set(true)
    )

    tree.applyTree(focus, 'focus')

    expect(terminalOpen.get()).toBe(true)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'workspace')?.active).toBe('workspace')
  })
})
