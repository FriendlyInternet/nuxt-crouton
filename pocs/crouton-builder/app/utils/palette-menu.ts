/**
 * Palette menu state (#3748) — which group's menu is open in Builder's block row,
 * and how it reacts to a drag. Lives outside `[pageId].vue` so the tap / hold-and-
 * drag behaviour is tested against the real board drag (`palette-menu.test.ts`).
 *
 *  · tapping an item closes the menu and adds the block (`add`);
 *  · once a held item arms a drag, the menu goes see-through (`dragging`) so the
 *    board under the finger receives it — unmounting it mid-gesture would drop
 *    the touch's target and let the browser scroll instead — and it closes when
 *    the drag ends;
 *  · the popover can't close itself while a drag is running.
 */
import { ref, watch, type Ref } from 'vue'

export function usePaletteMenu(dragPayload: Ref<unknown>, add: (blockId: string) => void) {
  const openGroup = ref<string | null>(null)
  const dragging = ref(false)

  watch(dragPayload, (p) => {
    if (p && openGroup.value) dragging.value = true
    else if (!p && dragging.value) {
      dragging.value = false
      openGroup.value = null
    }
  }, { flush: 'sync' })

  function setGroupOpen(key: string, open: boolean) {
    if (open) openGroup.value = key
    else if (openGroup.value === key && !dragging.value) openGroup.value = null
  }
  function onItemClick(blockId: string) {
    openGroup.value = null
    add(blockId)
  }

  return { openGroup, dragging, setGroupOpen, onItemClick }
}
