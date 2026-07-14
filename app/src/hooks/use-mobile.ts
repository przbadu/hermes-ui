import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'

import { useMediaQuery } from './use-media-query'

// Mobile-intent flag. Shares the single responsive breakpoint with the shell's
// sidebar collapse (SIDEBAR_COLLAPSE_BREAKPOINT_PX) so "the rails collapsed" and
// "we're on a phone" can never disagree by a pixel.
export const useIsMobile = () => useMediaQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)
