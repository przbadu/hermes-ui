/**
 * Compatibility seam for Desktop's layout renderer. Hermes UI has not yet
 * ported Desktop's multi-session tile store, so there are no persisted tile
 * records to clear before the tree closes its visible tabs.
 */
export function closeAllOpenSessionTiles(_paneId: string): void {}
