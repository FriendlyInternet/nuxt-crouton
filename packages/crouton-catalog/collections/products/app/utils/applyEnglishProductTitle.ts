// The I18nInput emits `update:english` when the English translation changes.
// The server requires a non-empty main `title`, so mirror English into it.
// Named apart from bookings' `applyEnglishTitle`: Nuxt auto-imports every
// layer's app/utils, and two exports with one name clash in a bookings app.
export function applyEnglishProductTitle(state: { title?: string | null }, data: { field: string, value: string }) {
  if (data.field === 'title') state.title = data.value
}
