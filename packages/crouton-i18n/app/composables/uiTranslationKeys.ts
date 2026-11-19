// Plain helpers for the admin "interface texts" list (UiList.vue).
// No Vue/Nuxt imports so they can be unit-tested directly. Callers pass
// already-unwrapped (toRaw) message objects.
//
// Why this exists: @nuxtjs/i18n 10 loads locale files on demand, so only the
// current language's messages are present. The list must load every configured
// language first and build its keys from all of them, not from English alone.

export interface UiTranslationKey {
  key: string
  value: string
}

function isCompiled(v: any): v is { loc: { source: string } } {
  return !!v && typeof v === 'object' && typeof v.loc?.source === 'string'
}

/** Read a dotted key from a messages object (plain string or vue-i18n compiled form). */
export function valueAt(messages: Record<string, any> | null | undefined, key: string): string | undefined {
  let current: any = messages
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = current[part]
  }
  if (typeof current === 'string') return current
  if (isCompiled(current)) return current.loc.source
  return undefined
}

/**
 * Flatten a messages object into dotted keys.
 * Handles vue-i18n compiled messages where each key is stored as:
 * { loc: { source: "value" }, body: { static: "value" } }
 */
function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function leafValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (isCompiled(v)) return v.loc.source
  return undefined
}

function flattenEntry(path: string, v: unknown, depth: number, seen: WeakSet<object>): UiTranslationKey[] {
  const leaf = leafValue(v)
  if (leaf !== undefined) return [{ key: path, value: leaf }]
  return isPlainObject(v) ? flattenMessages(v, path, depth + 1, seen) : []
}

export function flattenMessages(obj: Record<string, any>, prefix = '', depth = 0, seen = new WeakSet<object>()): UiTranslationKey[] {
  if (depth > 10 || !isPlainObject(obj) || seen.has(obj)) return []
  seen.add(obj)
  return Object.entries(obj).flatMap(([k, v]) =>
    flattenEntry(prefix ? `${prefix}.${k}` : k, v, depth, seen)
  )
}

/**
 * Union of keys across every language. Keys appear in order of first appearance
 * (walking `order`); each key's value is the first non-empty value in `order`.
 */
export function collectKeys(messagesByLocale: Record<string, Record<string, any> | null | undefined>, order: string[]): UiTranslationKey[] {
  const codes = [...new Set([...order, ...Object.keys(messagesByLocale)])]
  const keys: string[] = []
  const seenKeys = new Set<string>()
  for (const code of codes) {
    const messages = messagesByLocale[code]
    if (!messages) continue
    for (const { key } of flattenMessages(messages)) {
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        keys.push(key)
      }
    }
  }
  return keys.map((key) => {
    let value = ''
    for (const code of codes) {
      const v = valueAt(messagesByLocale[code], key)
      if (v) {
        value = v
        break
      }
    }
    return { key, value }
  })
}

/** Load every language's messages; one failing language does not stop the rest. */
export async function loadAllLocales<C extends string>(loadFn: (code: C) => Promise<unknown> | unknown, codes: C[]): Promise<void> {
  await Promise.all(codes.map(async (code) => {
    try {
      await loadFn(code)
    } catch (err) {
      console.warn(`[crouton-i18n] could not load messages for "${code}"`, err)
    }
  }))
}
