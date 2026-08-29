import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('layout presets with dynamic panes', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('restores a dynamic right-docked pane beside workspace after Focus', async () => {
    const model = await import('./model')
    const tree = await import('./store')
    const { registry } = await import('@/contrib/registry')

    registry.registerMany([
      { area: 'panes', data: { placement: 'left' }, id: 'sessions', render: () => null },
      { area: 'panes', data: { placement: 'left' }, id: 'bots', render: () => null },
      { area: 'panes', data: { placement: 'main', uncloseable: true }, id: 'workspace', render: () => null }
    ])

    const unregisterRoutines = registry.register({
      area: 'panes',
      data: { dock: { pane: 'workspace', pos: 'right' }, placement: 'main' },
      id: 'routines',
      render: () => null
    })

    const defaultTree = model.split(
      'row',
      [model.group(['sessions', 'bots']), model.group(['workspace']), model.group(['routines'])],
      [1, 4, 1]
    )

    const focusTree = model.split(
      'row',
      [model.group(['sessions']), model.group(['workspace'])],
      [1, 4]
    )

    tree.declareDefaultTree(defaultTree)
    tree.watchContributedPanes()

    // Bot Mode leaves before Focus is picked, so Cronjobs unregisters while
    // its old tree placeholder still exists.
    unregisterRoutines()
    tree.applyTree(focusTree, 'focus')

    expect(model.allPaneIds(tree.$layoutTree.get()!)).not.toContain('routines')

    // Re-entering Bot Mode registers Cronjobs again. Its contribution dock,
    // not the preset's first group, determines where it returns.
    registry.register({
      area: 'panes',
      data: { dock: { pane: 'workspace', pos: 'right' }, placement: 'main' },
      id: 'routines',
      render: () => null
    })

    const restored = tree.$layoutTree.get()!
    const routinesGroup = model.findGroupOfPane(restored, 'routines')
    const workspaceGroup = model.findGroupOfPane(restored, 'workspace')
    const parent = routinesGroup ? model.findParentSplit(restored, routinesGroup.id) : null

    expect(routinesGroup?.panes).toEqual(['routines'])
    expect(workspaceGroup?.panes).toEqual(['workspace'])
    expect(parent?.orientation).toBe('row')
    const childIds = parent?.children.map(child => child.id) ?? []

    expect(childIds.indexOf(routinesGroup!.id)).toBe(childIds.indexOf(workspaceGroup!.id) + 1)
  })

  it('uses a registered pane dock while applying Focus', async () => {
    const model = await import('./model')
    const tree = await import('./store')
    const { registry } = await import('@/contrib/registry')

    registry.registerMany([
      { area: 'panes', data: { placement: 'left' }, id: 'sessions', render: () => null },
      { area: 'panes', data: { placement: 'main', uncloseable: true }, id: 'workspace', render: () => null },
      {
        area: 'panes',
        data: { dock: { pane: 'workspace', pos: 'right' }, placement: 'main' },
        id: 'routines',
        render: () => null
      }
    ])

    tree.declareDefaultTree(
      model.split('row', [model.group(['sessions']), model.group(['workspace']), model.group(['routines'])])
    )
    tree.applyTree(model.split('row', [model.group(['sessions']), model.group(['workspace'])]), 'focus')

    const applied = tree.$layoutTree.get()!
    const routinesGroup = model.findGroupOfPane(applied, 'routines')
    const workspaceGroup = model.findGroupOfPane(applied, 'workspace')
    const parent = routinesGroup ? model.findParentSplit(applied, routinesGroup.id) : null

    expect(routinesGroup?.panes).toEqual(['routines'])
    const childIds = parent?.children.map(child => child.id) ?? []

    expect(childIds.indexOf(routinesGroup!.id)).toBe(childIds.indexOf(workspaceGroup!.id) + 1)
  })
})
