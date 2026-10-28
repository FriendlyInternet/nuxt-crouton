/**
 * Compact relative label for an age in ms: "just now" / "12s ago" / "4m ago" / "2h ago".
 * Shared by the sync status banner, the linked-devices list and the sync details.
 */
export function useSyncAge() {
  const { t } = useT()
  return (ms: number): string => {
    const s = Math.max(0, Math.round(ms / 1000))
    if (s < 5) return t('sales.sync.justNow')
    if (s < 60) return t('sales.sync.secondsAgo', { n: s })
    const m = Math.round(s / 60)
    if (m < 60) return t('sales.sync.minutesAgo', { n: m })
    return t('sales.sync.hoursAgo', { n: Math.round(m / 60) })
  }
}
