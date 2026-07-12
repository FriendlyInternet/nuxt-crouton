/**
 * @crouton-package crouton-sales
 * @description Shared scaffold for the sales collection forms (Category /
 * Location / Printer / Product): mutation wiring, activeItem-merged state,
 * the create/update/delete submit switch, and the in-form two-step delete.
 *
 * Extracted from the four per-form copies the #1391 fallow audit flagged as
 * clone groups — new sales forms should start here instead of re-pasting the
 * boilerplate. Per-form validation (ProductForm/PrinterForm superRefine) stays
 * in the form; this only owns the shared lifecycle.
 */

export interface SalesCollectionFormProps {
  action: 'create' | 'update' | 'delete'
  items?: Array<{ id: string }>
  activeItem?: Record<string, any> | null
}

export function useSalesCollectionForm(
  props: SalesCollectionFormProps,
  options: { collection: string, defaultValue: Record<string, any> }
) {
  const { create, update, deleteItems } = useCollectionMutation(options.collection)
  const { close, loading } = useCrouton()

  // Merge activeItem for both create (preset eventId from the event workspace)
  // and update (the full record being edited). initFormState coerces a nullable
  // column's loaded null back to the form default, so it never reaches the
  // narrow client schema and silently blocks submit (#1498).
  const initialValues = initFormState(options.defaultValue, props.activeItem)
  const state = ref<Record<string, any> & { id?: string | null }>(initialValues)

  // Event is implied by the workspace — hide the selector when it's preset.
  const hideEvent = computed(() => !!state.value.eventId)

  const submitters: Record<SalesCollectionFormProps['action'], () => Promise<unknown> | undefined> = {
    create: () => create(state.value),
    update: () => (state.value.id ? update(state.value.id, state.value) : undefined),
    delete: () => deleteItems((props.items ?? []).map(i => i.id))
  }
  const submitAction = () => submitters[props.action]?.()

  const handleSubmit = async () => {
    try {
      await submitAction()
      close()
    } catch (error) {
      console.error('Form submission failed:', error)
    }
  }

  // Delete stays in-form (a nested overlay would leave this slideover open on
  // a deleted record); the arm→confirm step lives in CroutonDeleteButton.
  const deleting = ref(false)

  const handleDelete = async () => {
    if (!state.value.id) return
    deleting.value = true
    try {
      await deleteItems([state.value.id])
      close()
    } catch (error) {
      console.error('Delete failed:', error)
    } finally {
      deleting.value = false
    }
  }

  // submitAction is exposed for forms that wrap submit with their own
  // pre-processing/validation bookkeeping (PrinterForm, ProductForm).
  return { state, hideEvent, loading, close, submitAction, handleSubmit, deleting, handleDelete }
}
