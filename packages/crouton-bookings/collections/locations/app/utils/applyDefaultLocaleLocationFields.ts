// The I18nInput emits `update:english` when the translation in the app's
// default language changes (not necessarily English). The server requires a
// non-empty main `title`, and readers (cards, calendar, emails) fall back to
// the main columns, so mirror the default language's title and content into them.
// Named apart from catalog's `applyDefaultLocaleProductFields`: Nuxt
// auto-imports every layer's app/utils, and two exports with one name clash.
export function applyDefaultLocaleLocationFields(
  state: { title?: string | null, content?: string | null },
  data: { field: string, value: string }
) {
  if (data.field === 'title') state.title = data.value
  else if (data.field === 'content') state.content = data.value
}
