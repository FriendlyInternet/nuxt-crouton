/**
 * useAccountSettingsModal
 *
 * Opens the single account-settings overlay over the current page (bottom
 * sheet on phone, centred modal on desktop) via Nuxt UI's useOverlay().
 * Never changes the URL. Browser-only: call open() from a click or onMounted.
 *
 * The overlay handle holds a component + functions, so it lives in a module
 * variable (not useState, which is serialised server -> browser).
 */
import { AccountSettingsModal } from '#components'

type OverlayHandle = ReturnType<ReturnType<typeof useOverlay>['create']>

let handle: OverlayHandle | null = null
let openCount = 0

export function useAccountSettingsModal() {
  function open(tab = 'profile') {
    if (!import.meta.client) return
    if (!handle) {
      handle = useOverlay().create(AccountSettingsModal)
    }
    // Fresh key per open: UDrawer is never unmounted, and Settings reads its tab once
    openCount++
    handle.open({ defaultTab: tab, openKey: openCount } as any)
  }

  function close() {
    handle?.close()
  }

  return { open, close }
}
