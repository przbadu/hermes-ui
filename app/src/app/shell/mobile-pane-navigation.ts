import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { matchesQuery } from '@/hooks/use-media-query'
import { CHAT_SIDEBAR_PANE_ID } from '@/store/layout'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '../layout-constants'

/** Dismiss the floating Sessions/Bots drawer after its content navigates. */
export function dismissMobileChatSidebar(): void {
  if (!matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
    return
  }

  window.dispatchEvent(
    new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, {
      detail: { id: CHAT_SIDEBAR_PANE_ID, mode: 'close' }
    })
  )
}
