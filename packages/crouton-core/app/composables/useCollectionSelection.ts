import { computed, inject, provide, readonly, ref, toValue, type InjectionKey, type MaybeRefOrGetter, type Ref } from 'vue'
import { CROUTON_ITEM_ACTION_KEY, type CroutonItemAction } from '../types/table'

/**
 * Which record of a collection is open, and where it opens (#2598).
 *
 * One selection per collection, shared by every block on a page: the list asks it
 * to open a row, the form shows whatever it holds. Where a record opens follows from
 * what is on screen, never the viewport — a form block that is mounted registers
 * itself (`attachEditor`), so rows open beside the list; with no form on screen they
 * open in an overlay, as they always did. Delete always confirms in a modal.
 *
 * Extracted from CollectionViewer's inline split view so the layout blocks share the
 * same logic instead of a copy. The page provides it (`provideCollectionSelections`);
 * without a provider a block gets a private one, which means "overlay", today's behaviour.
 */

export type CollectionSelectionMode = 'idle' | 'create' | 'edit' | 'view'
type OverlayContainer = 'slideover' | 'modal' | 'dialog'
type OpenOverlay = (
  action: 'create' | 'update' | 'delete' | 'view',
  collection: string,
  ids: string[],
  container: OverlayContainer,
  initialData?: any,
) => void

export interface CollectionSelectionOptions {
  /** Open an overlay — `useCrouton().open` in the app. */
  open: OpenOverlay
  /** The overlay a collection opens in when no form is on screen (default slideover). */
  containerFor?: (collection: string) => OverlayContainer
}

export interface CollectionSelection {
  collection: string
  itemId: Readonly<Ref<string | null>>
  mode: Readonly<Ref<CollectionSelectionMode>>
  /** Bumps whenever a record is (re)opened — key the editor on it to reload. */
  sessionKey: Readonly<Ref<number>>
  hasEditor: Readonly<Ref<boolean>>
  act: CroutonItemAction
  /** A form on screen registers itself; call the returned function when it leaves. */
  attachEditor: () => () => void
  saved: (item?: { id?: string } | null) => void
  deleted: () => void
  cancelled: () => void
}

function createSelection(collection: string, opts: CollectionSelectionOptions): CollectionSelection {
  const itemId = ref<string | null>(null)
  const mode = ref<CollectionSelectionMode>('idle')
  const sessionKey = ref(0)
  const editors = ref(0)

  function show(next: CollectionSelectionMode, id: string | null) {
    itemId.value = id
    mode.value = next
    sessionKey.value++
  }

  const act: CroutonItemAction = (action, ids = [], initialData) => {
    if (action === 'delete') return opts.open('delete', collection, ids, 'modal', initialData)
    if (editors.value === 0) {
      return opts.open(action, collection, ids, opts.containerFor?.(collection) ?? 'slideover', initialData)
    }
    if (action === 'create') show('create', null)
    else show(action === 'view' ? 'view' : 'edit', ids[0] ?? null)
  }

  function attachEditor() {
    editors.value++
    let attached = true
    return () => {
      if (!attached) return
      attached = false
      editors.value--
    }
  }

  function saved(item?: { id?: string } | null) {
    if (item?.id) {
      itemId.value = item.id
      mode.value = 'edit'
    }
    sessionKey.value++
  }

  function deleted() {
    itemId.value = null
    mode.value = 'idle'
  }

  function cancelled() {
    if (mode.value === 'create') deleted()
  }

  return {
    collection,
    itemId: readonly(itemId),
    mode: readonly(mode),
    sessionKey: readonly(sessionKey),
    hasEditor: computed(() => editors.value > 0),
    act,
    attachEditor,
    saved,
    deleted,
    cancelled,
  }
}

export interface CollectionSelections {
  get: (collection: string) => CollectionSelection
}

/** A page's set of selections, one per collection, created on first ask. Pure — no Nuxt. */
export function createCollectionSelections(opts: CollectionSelectionOptions): CollectionSelections {
  const byCollection = new Map<string, CollectionSelection>()
  return {
    get(collection) {
      let s = byCollection.get(collection)
      if (!s) byCollection.set(collection, (s = createSelection(collection, opts)))
      return s
    },
  }
}

const SELECTIONS_KEY: InjectionKey<CollectionSelections> = Symbol('croutonCollectionSelections')

function appOptions(): CollectionSelectionOptions {
  const crouton = useCrouton()
  const { getConfig } = useCollections()
  return {
    open: (action, collection, ids, container, initialData) =>
      crouton.open(action, collection, ids, container, initialData),
    containerFor: (collection) => {
      const container = getConfig(collection)?.container ?? 'slideover'
      return container === 'inline' ? 'slideover' : container
    },
  }
}

/** Call once in a page (or any surface) whose blocks should share selections. */
export function provideCollectionSelections(): CollectionSelections {
  const selections = createCollectionSelections(appOptions())
  provide(SELECTIONS_KEY, selections)
  return selections
}

/** The page's selections — or a private set when nothing provides them (overlay behaviour). */
export function useCollectionSelections(): CollectionSelections {
  return inject(SELECTIONS_KEY, null) ?? createCollectionSelections(appOptions())
}

/**
 * Route every row action (open, new, delete) of the lists under this component to
 * the selection of `collection` — what a list block or CollectionViewer calls.
 */
export function provideSelectionItemActions(
  collection: MaybeRefOrGetter<string | undefined>,
  selections: CollectionSelections = useCollectionSelections(),
): void {
  provide(CROUTON_ITEM_ACTION_KEY, (action, ids, initialData) => {
    const name = toValue(collection)
    if (name) selections.get(name).act(action, ids, initialData)
  })
}
