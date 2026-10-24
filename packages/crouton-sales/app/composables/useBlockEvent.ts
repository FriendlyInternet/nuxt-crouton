/**
 * Resolve a block's configured event slug to an id (#1762).
 *
 * The sales block editors store an event **slug**, not an id — so the page's
 * content stays valid if the event row is regenerated, and so the seed doesn't
 * depend on insert ordering. Every block renderer therefore resolves the slug
 * against the public by-slug endpoint on mount, and every one of them had
 * written the same twelve lines to do it.
 *
 * `notFound` is a distinct state from "not resolved yet": a deleted event or a
 * stale slug must render an explanation, not an empty board that looks merely
 * quiet.
 */
export function useBlockEvent(eventSlug: Ref<string>) {
  const route = useRoute()
  const teamParam = computed(() => String(route.params.team || ''))

  const eventId = ref<string | null>(null)
  const notFound = ref(false)

  async function resolve() {
    if (!eventSlug.value || !teamParam.value) return
    try {
      const ev = await $fetch<{ id: string }>(
        `/api/crouton-sales/events/${teamParam.value}/by-slug/${eventSlug.value}`
      )
      eventId.value = ev.id
    }
    catch {
      notFound.value = true
    }
  }

  return { eventId, notFound, teamParam, resolve }
}
