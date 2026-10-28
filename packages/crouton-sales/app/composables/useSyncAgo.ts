/** i18n key + count for an age in seconds. */
function agePart(s: number): [string, number] {
  if (s < 5) return ['justNow', 0]
  if (s < 60) return ['secondsAgo', s]
  if (s < 3600) return ['minutesAgo', Math.round(s / 60)]
  return ['hoursAgo', Math.round(s / 3600)]
}

/**
 * "x ago" label for a timestamp against `now` (both ms): "never" / "just now" / "12s ago" /
 * "4m ago" / "2h ago". Shared by the sync status banner, the linked-devices list and the details.
 */
export function useSyncAgo() {
  const { t } = useT()
  return (at: number | null | undefined, now: number): string => {
    if (!at) return t('sales.sync.never')
    const [key, n] = agePart(Math.max(0, Math.round((now - at) / 1000)))
    return t(`sales.sync.${key}`, { n })
  }
}
