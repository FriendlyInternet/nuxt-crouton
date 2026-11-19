// The I18nInput emits `update:english` when the translation in the app's
// default language changes (not necessarily English). The email sender falls
// back to the main `name/subject/body` columns for a customer whose language
// has no translation, so mirror the default language's fields into them —
// otherwise a template saved in another language sends an empty email.
// Named apart from the location/product helpers: Nuxt auto-imports every
// layer's app/utils, and two exports with one name clash.
export function applyDefaultLocaleEmailtemplateFields(
  state: { name?: string | null, subject?: string | null, body?: string | null },
  data: { field: string, value: string }
) {
  if (data.field === 'name') state.name = data.value
  else if (data.field === 'subject') state.subject = data.value
  else if (data.field === 'body') state.body = data.value
}
