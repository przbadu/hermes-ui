import { computed } from 'nanostores'
import { createContext, type ReactNode, useContext } from 'react'

import { $terminalTakeover, setTerminalTakeover } from '@/app/right-sidebar/store'
import { group, split } from '@/components/pane-shell/tree/model'
import {
  bindPaneVisibility,
  bindToolPaneCollapse,
  bindTreeSideVisibility,
  declareDefaultTree,
  revealTreePane,
  watchContributedPanes
} from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'
import {
  $fileBrowserOpen,
  $sidebarOpen,
  FILE_BROWSER_DEFAULT_WIDTH,
  FILE_BROWSER_MAX_WIDTH,
  FILE_BROWSER_MIN_WIDTH,
  setFileBrowserOpen,
  setSidebarOpen,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH
} from '@/store/layout'
import { $paneOpen } from '@/store/panes'
import { $filePreviewTarget, $previewTarget, closeActiveRightRailTab } from '@/store/preview'
import { $reviewOpen, closeReview, openReview } from '@/store/review'
import { $currentCwd } from '@/store/session'
import { isSecondaryWindow } from '@/store/windows'

export const PANES_AREA = 'panes'
export const LAYOUTS_AREA = 'layouts'

export type CoreLayoutPaneId = 'files' | 'preview' | 'review' | 'sessions' | 'terminal' | 'workspace'

type PaneContents = Partial<Record<CoreLayoutPaneId, ReactNode>>

const PaneContentsContext = createContext<PaneContents>({})

export function LayoutPaneContents({ children, panes }: { children: ReactNode; panes: PaneContents }) {
  return <PaneContentsContext.Provider value={panes}>{children}</PaneContentsContext.Provider>
}

function CorePane({ id }: { id: CoreLayoutPaneId }) {
  return useContext(PaneContentsContext)[id] ?? null
}

const renderCorePane = (id: CoreLayoutPaneId) => () => <CorePane id={id} />

const DEFAULT_TREE = split(
  'row',
  [
    group(['sessions'], { id: 'grp-sessions' }),
    group(['workspace'], { id: 'grp-main' }),
    split(
      'column',
      [
        split(
          'row',
          [group(['review'], { id: 'grp-review' }), group(['files'], { id: 'grp-files' })],
          [1, 1.2],
          'spl-rail'
        ),
        group(['terminal'], { id: 'grp-terminal' })
      ],
      [1.6, 1],
      'spl-right'
    )
  ],
  [1, 3.4, 1.25],
  'spl-root'
)

const FOCUS_TREE = split('row', [group(['sessions']), group(['workspace', 'files', 'review', 'terminal'])], [1, 4.6])

const TERMINAL_TREE = split(
  'column',
  [
    split('row', [group(['sessions']), group(['workspace']), group(['files', 'review'])], [1, 3.2, 1.2]),
    group(['terminal'])
  ],
  [3, 1]
)

const QUAD_TREE = split(
  'column',
  [
    split('row', [group(['sessions', 'files']), group(['workspace'])], [1, 3]),
    split('row', [group(['terminal']), group(['review'])], [1.4, 1])
  ],
  [3, 1]
)

let registered = false
let watching = false
let wired = false
let unregisterPreviewPane: null | (() => void) = null

const PREVIEW_PANE = {
  area: PANES_AREA,
  data: {
    dock: { pane: 'workspace', pos: 'right' },
    maxWidth: '38rem',
    minWidth: '18rem',
    narrowCollapsible: true,
    narrowSide: 'right',
    placement: 'main',
    width: '32vw'
  },
  id: 'preview',
  render: renderCorePane('preview'),
  source: 'core' as const,
  title: 'Preview'
}

function wireCoreLayoutStores(): void {
  if (wired || isSecondaryWindow()) {
    return
  }

  wired = true
  const $hasWorkspace = computed($currentCwd, cwd => Boolean(cwd.trim()))

  const $previewOpen = computed(
    [$previewTarget, $filePreviewTarget, $paneOpen('preview')],
    (preview, filePreview, open) => Boolean(open && (preview || filePreview))
  )

  bindTreeSideVisibility('left', $sidebarOpen, setSidebarOpen)
  bindTreeSideVisibility('right', $fileBrowserOpen, setFileBrowserOpen)
  bindPaneVisibility(
    'files',
    computed([$hasWorkspace, $fileBrowserOpen], (workspace, open) => workspace && open),
    () => setFileBrowserOpen(false),
    () => setFileBrowserOpen(true)
  )
  bindPaneVisibility(
    'review',
    computed([$hasWorkspace, $reviewOpen], (workspace, open) => workspace && open),
    closeReview,
    openReview
  )
  bindPaneVisibility('preview', $previewOpen, closeActiveRightRailTab)
  bindToolPaneCollapse(
    'terminal',
    $terminalTakeover,
    () => setTerminalTakeover(false),
    () => setTerminalTakeover(true)
  )

  $reviewOpen.listen(open => open && revealTreePane('review'))
  $previewTarget.listen(target => target && revealTreePane('preview'))
  $filePreviewTarget.listen(target => target && revealTreePane('preview'))
  $terminalTakeover.listen(open => open && revealTreePane('terminal'))

  const syncPreviewPane = (open: boolean) => {
    if (open && !unregisterPreviewPane) {
      unregisterPreviewPane = registry.register(PREVIEW_PANE)
    } else if (!open && unregisterPreviewPane) {
      unregisterPreviewPane()
      unregisterPreviewPane = null
    }
  }

  $previewOpen.listen(syncPreviewPane)
  syncPreviewPane($previewOpen.get())
}

/** Register the same pane and layout contribution areas used by Desktop. */
export function registerCoreLayoutContributions(): void {
  if (registered) {
    return
  }

  registered = true

  registry.registerMany([
    {
      area: PANES_AREA,
      data: {
        collapsible: true,
        dock: { pane: 'workspace', pos: 'left' },
        hideOnly: true,
        maxWidth: `${SIDEBAR_MAX_WIDTH}px`,
        minWidth: `${SIDEBAR_DEFAULT_WIDTH}px`,
        placement: 'left',
        revealAliases: ['chat-sidebar'],
        width: `${SIDEBAR_DEFAULT_WIDTH}px`
      },
      id: 'sessions',
      render: renderCorePane('sessions'),
      source: 'core',
      title: 'Sessions'
    },
    {
      area: PANES_AREA,
      data: { minWidth: '22vw', placement: 'main', uncloseable: true },
      id: 'workspace',
      render: renderCorePane('workspace'),
      source: 'core',
      title: 'Chat'
    },
    {
      area: PANES_AREA,
      data: { height: '20vh', lifecycleKeepAlive: true, maxHeight: '80vh', placement: 'bottom', revealOnPreset: true },
      id: 'terminal',
      render: renderCorePane('terminal'),
      source: 'core',
      title: 'Terminal'
    },
    {
      area: PANES_AREA,
      data: {
        collapsible: true,
        dock: { pane: 'workspace', pos: 'right' },
        maxWidth: FILE_BROWSER_MAX_WIDTH,
        minWidth: FILE_BROWSER_MIN_WIDTH,
        placement: 'right',
        revealAliases: ['file-browser'],
        width: FILE_BROWSER_DEFAULT_WIDTH
      },
      id: 'files',
      render: renderCorePane('files'),
      source: 'core',
      title: 'Files'
    },
    {
      area: PANES_AREA,
      data: {
        collapsible: true,
        maxWidth: FILE_BROWSER_MAX_WIDTH,
        minWidth: FILE_BROWSER_MIN_WIDTH,
        placement: 'right',
        revealAliases: ['review'],
        width: FILE_BROWSER_DEFAULT_WIDTH
      },
      id: 'review',
      render: renderCorePane('review'),
      source: 'core',
      title: 'Review'
    }
  ])

  registry.registerMany([
    { area: LAYOUTS_AREA, data: DEFAULT_TREE, id: 'default', order: 0, source: 'core', title: 'Default' },
    { area: LAYOUTS_AREA, data: FOCUS_TREE, id: 'focus', order: 10, source: 'core', title: 'Focus' },
    { area: LAYOUTS_AREA, data: TERMINAL_TREE, id: 'terminal-deck', order: 20, source: 'core', title: 'Terminal deck' },
    { area: LAYOUTS_AREA, data: QUAD_TREE, id: 'quad', order: 30, source: 'core', title: 'Quad' }
  ])

  declareDefaultTree(isSecondaryWindow() ? group(['workspace'], { id: 'grp-main' }) : DEFAULT_TREE)
  wireCoreLayoutStores()
}

/** Start live plugin-pane adoption after bundled plugins have registered. */
export function watchLayoutContributions(): void {
  if (watching) {
    return
  }

  watching = true
  watchContributedPanes()
}
