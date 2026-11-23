// The I18nInput emits `update:english` when the translation in the app's
// default language changes (not necessarily English). The server requires a
// non-empty main `title`, and readers fall back to the main columns, so mirror
// the default language's title and description into them.
// Named apart from bookings' `applyDefaultLocaleLocationFields`: Nuxt
// auto-imports every layer's app/utils, and two exports with one name clash in
// a bookings app.
export function applyDefaultLocaleProductFields(
  state: { title?: string | null, description?: string | null },
  data: { field: string, value: string }
) {
  if (data.field === 'title') state.title = data.value
  else if (data.field === 'description') state.description = data.value
}
