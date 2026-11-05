/**
 * Shared ghost page state for sidebar tree.
 *
 * Shows a placeholder node in the sidebar while a new page is being created.
 * The editor can update the ghost's title/slug as the user types.
 */
export function useGhostPage() {
  const { t } = useT()
  const ghost = useState<{
    id: string
    parentId: string | null
    title: string
    slug: string
    status: string
    order: number
    _ghost: true
  } | null>('ghostPage', () => null)

  function setGhost(parentId: string | null) {
    ghost.value = {
      id: '__ghost__',
      parentId,
      title: t('pages.newPagePlaceholder'),
      slug: '',
      status: 'draft',
      order: Infinity,
      _ghost: true
    }
  }

  function clearGhost() {
    ghost.value = null
  }

  function updateGhost(fields: { title?: string, slug?: string }) {
    if (ghost.value) {
      ghost.value = { ...ghost.value, ...fields }
    }
  }

  return { ghost, setGhost, clearGhost, updateGhost }
}
