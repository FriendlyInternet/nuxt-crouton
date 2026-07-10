/**
 * Undo (#940): snapshot the whole board before each mutation; Undo restores the last snapshot.
 * `nodes` is the complete board state, so a deep-cloned snapshot is a full, safe restore point.
 * Cleared on entering a page (`clearUndo`). ⌘/Ctrl-Z undoes, on the board only — `enabled`
 * gates the keystroke and inputs/textareas keep their native undo.
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { JSONclone } from '~/utils/spike-board'
import type { FlowNode } from '~/utils/spike-board'

const UNDO_LIMIT = 50

export function useSpikeUndo(nodes: Ref<FlowNode[]>, opts: { onRestore: () => void, enabled: () => boolean }) {
  const undoStack = ref<FlowNode[][]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  function pushUndo() {
    undoStack.value.push(JSONclone(nodes.value))
    if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift()
  }
  function undo() {
    const prev = undoStack.value.pop()
    if (!prev) return
    opts.onRestore()
    nodes.value = prev
  }
  function clearUndo() {
    undoStack.value = []
  }
  onKeyStroke('z', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return
    if (!opts.enabled()) return
    const t = e.target as HTMLElement | null
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return
    e.preventDefault()
    undo()
  })
  return { canUndo, pushUndo, undo, clearUndo }
}
