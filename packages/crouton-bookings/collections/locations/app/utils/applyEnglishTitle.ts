// The I18nInput emits `update:english` when the English translation changes.
// The server requires a non-empty main `title`, so mirror English into it.
export function applyEnglishTitle(state: { title?: string | null }, data: { field: string, value: string }) {
  if (data.field === 'title') state.title = data.value
}
