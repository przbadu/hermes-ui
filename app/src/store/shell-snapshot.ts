import { $sidebarOpen, $sidebarWidth } from '@/store/layout'

// A tiny, display-only snapshot of the app-shell chrome, persisted so the inline
// pre-paint script in index.html can draw a themed skeleton (titlebar + sidebar
// rail + rows) on the very first frame — before the ~28MB bundle has parsed and
// React has mounted. It is purely cosmetic: it seeds NO application data and is
// never read back into the running app. See the body script in index.html.
const SNAPSHOT_KEY = 'hermes-shell-snapshot'

// Bumped when the snapshot shape changes so a stale entry from an older build is
// ignored rather than mis-rendered. The pre-paint script checks this too.
const SCHEMA_VERSION = 1

export interface ShellSnapshot {
  v: number
  scheme: null | string
  chromeBg: null | string
  sidebarBg: string
  sidebarBorder: string
  rowColor: string
  sidebarOpen: boolean
  sidebarWidth: number
}

// The shell surface colors live as CSS custom properties that applyTheme() sets
// on :root, so we read them from the computed cascade rather than duplicating
// any theme logic here.
function readColors(): null | Pick<ShellSnapshot, 'rowColor' | 'sidebarBg' | 'sidebarBorder'> {
  const s = getComputedStyle(document.documentElement)
  const sidebarBg = s.getPropertyValue('--ui-sidebar-surface-background').trim()

  // If the theme's CSS vars haven't resolved yet (called before styles apply),
  // bail so we never overwrite a good snapshot with empties.
  if (!sidebarBg) {
    return null
  }

  return {
    sidebarBg,
    sidebarBorder: s.getPropertyValue('--sidebar-edge-border').trim(),
    rowColor: s.getPropertyValue('--ui-text-quaternary').trim()
  }
}

let scheduled = false

function flush(): void {
  scheduled = false

  try {
    const colors = readColors()

    if (!colors) {
      return
    }

    const snapshot: ShellSnapshot = {
      v: SCHEMA_VERSION,
      scheme: document.documentElement.style.colorScheme || null,
      chromeBg: window.localStorage.getItem('hermes-boot-background'),
      sidebarOpen: $sidebarOpen.get(),
      sidebarWidth: $sidebarWidth.get(),
      ...colors
    }

    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Storage / DOM unavailable — the pre-paint script degrades to a plain
    // themed background, exactly as before this feature existed.
  }
}

// Coalesce the several rapid triggers at boot (theme apply + two store
// subscriptions firing immediately) into one write on the next frame.
function schedule(): void {
  if (scheduled || typeof window === 'undefined') {
    return
  }

  scheduled = true
  requestAnimationFrame(flush)
}

// Called from applyTheme() once the surface colors are known, so the snapshot's
// colors are captured (and refreshed on every theme change).
export function refreshShellSnapshot(): void {
  schedule()
}

// Subscribe to the layout atoms so open/width changes keep the snapshot current.
// nanostores fires the callback immediately with the current value, so this also
// seeds the first write.
export function initShellSnapshot(): void {
  if (typeof window === 'undefined') {
    return
  }

  $sidebarOpen.subscribe(schedule)
  $sidebarWidth.subscribe(schedule)
}
