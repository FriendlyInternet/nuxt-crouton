/**
 * useCroutonNavPill
 *
 * A cross-package action slot for the floating nav pill (CroutonPagesNav).
 * Any layer can contribute an icon button to the pill WITHOUT a hard dependency
 * on crouton-pages — the actions live in a shared `useState` key (the same
 * decoupling the theme menu uses via `crouton:themePreferenceItems`), so a
 * package that only sometimes ships alongside the nav can register safely.
 *
 * Registration is CLIENT-SIDE (actions carry functions, which don't serialize):
 * call `register()` from `onMounted` and the returned unregister from
 * `onUnmounted`. Nav renders the actions inside `<ClientOnly>`, so SSR sees an
 * empty list and there's no hydration mismatch.
 *
 * The pages package itself is the first consumer — it registers the
 * "edit this page" pencil (see `[...slug].vue`).
 *
 * @example
 * ```ts
 * const { register } = useCroutonNavPill()
 * onMounted(() => {
 *   const off = register({
 *     id: 'edit-page',
 *     icon: 'i-lucide-pencil',
 *     label: t('pages.admin.editPage'),
 *     onSelect: startEditing,
 *     show: () => isAdmin.value && !isEditing.value && !!page.value?.id,
 *   })
 *   onUnmounted(off)
 * })
 * ```
 */

export interface CroutonNavPillAction {
  /** Stable id — re-registering the same id is a no-op (deduped). */
  id: string
  /** Lucide icon class, e.g. `i-lucide-pencil`. */
  icon: string
  /** Accessible label (also the tooltip). */
  label: string
  /** Click handler. */
  onSelect: () => void
  /** Lower renders first (default 0). */
  order?: number
  /** Optional reactive visibility — a getter or ref; omitted ⇒ always shown. */
  show?: (() => boolean) | Ref<boolean>
}

const KEY = 'crouton:navPillActions'

export function useCroutonNavPill() {
  const actions = useState<CroutonNavPillAction[]>(KEY, () => [])

  /** Register a pill action; returns an unregister fn (call it on unmount). */
  function register(action: CroutonNavPillAction): () => void {
    if (!actions.value.some(a => a.id === action.id)) {
      actions.value = [...actions.value, action]
    }
    return () => {
      actions.value = actions.value.filter(a => a.id !== action.id)
    }
  }

  /** The actions to render, filtered by `show` and ordered — reactive. */
  const visibleActions = computed(() =>
    actions.value
      .filter(a => a.show === undefined || (typeof a.show === 'function' ? a.show() : unref(a.show)))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  )

  return { register, visibleActions }
}
