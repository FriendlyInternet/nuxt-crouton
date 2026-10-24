/**
 * Thin wrapper over useCroutonStatus() keeping the old shape. Removed once
 * the status pill replaces the bar (epic #2421).
 */
export function useAdminStatusBar() {
  const { messages, current, lastMessage, push } = useCroutonStatus()

  const addMessage = (msg: { text: string, icon?: string, type: 'success' | 'warning' | 'error', collection?: string, operation?: string }) => {
    push(msg)
  }

  return { messages, currentMessage: current, lastMessage, addMessage }
}
