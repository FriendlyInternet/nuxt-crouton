/**
 * #2598 contract — one selection per collection, shared by every block on the page.
 *
 * Today the "which record is open, and where" state lives inside CollectionViewer
 * (and again inside Workspace). Extracted, the page provides it once and the list
 * and form blocks share it — so a row tapped in the list opens in the form beside it.
 * When no form is on the screen (e.g. the phone layout leaves it out), the record
 * opens in a slide-over instead, exactly like today.
 */
import { describe, it, expect, vi } from 'vitest'
import { createCollectionSelections } from '../useCollectionSelection'

const setup = () => {
  const open = vi.fn() // stands in for useCrouton().open — the slide-over
  const selections = createCollectionSelections({ open })
  return { open, selections }
}

describe('collection selection (#2598)', () => {
  it('starts with nothing open', () => {
    const { selections } = setup()
    const s = selections.get('artists')
    expect(s.itemId.value).toBeNull()
    expect(s.mode.value).toBe('idle')
  })

  it('blocks asking for the same collection share one selection', () => {
    const { selections } = setup()
    expect(selections.get('artists')).toBe(selections.get('artists'))
    expect(selections.get('artists')).not.toBe(selections.get('venues'))
  })

  it('with a form on screen, tapping a row opens it in that form', () => {
    const { open, selections } = setup()
    const s = selections.get('artists')
    const detach = s.attachEditor()
    s.act('update', ['a1'])
    expect(s.itemId.value).toBe('a1')
    expect(s.mode.value).toBe('edit')
    expect(open).not.toHaveBeenCalled()
    detach()
  })

  it('with no form on screen, tapping a row opens a slide-over (today\'s behaviour)', () => {
    const { open, selections } = setup()
    selections.get('artists').act('update', ['a1'])
    expect(open).toHaveBeenCalledWith('update', 'artists', ['a1'], 'slideover', undefined)
  })

  it('when the form leaves the screen, the next tap falls back to the slide-over', () => {
    const { open, selections } = setup()
    const s = selections.get('artists')
    const detach = s.attachEditor()
    detach()
    s.act('update', ['a1'])
    expect(open).toHaveBeenCalledOnce()
  })

  it('"new" clears the selection and opens an empty form', () => {
    const { selections } = setup()
    const s = selections.get('artists')
    s.attachEditor()
    s.act('update', ['a1'])
    s.act('create')
    expect(s.itemId.value).toBeNull()
    expect(s.mode.value).toBe('create')
  })

  it('saving a new record keeps it open, now as that record', () => {
    const { selections } = setup()
    const s = selections.get('artists')
    s.attachEditor()
    s.act('create')
    s.saved({ id: 'a9' })
    expect(s.itemId.value).toBe('a9')
    expect(s.mode.value).toBe('edit')
  })

  it('deleting the open record closes it', () => {
    const { selections } = setup()
    const s = selections.get('artists')
    s.attachEditor()
    s.act('update', ['a1'])
    s.deleted()
    expect(s.itemId.value).toBeNull()
    expect(s.mode.value).toBe('idle')
  })

  it('cancel on a new record closes it; cancel on an existing one keeps it', () => {
    const { selections } = setup()
    const s = selections.get('artists')
    s.attachEditor()
    s.act('create'); s.cancelled()
    expect(s.mode.value).toBe('idle')
    s.act('update', ['a1']); s.cancelled()
    expect(s.itemId.value).toBe('a1')
  })

  it('delete always asks for confirmation in a modal, even with a form on screen', () => {
    const { open, selections } = setup()
    const s = selections.get('artists')
    s.attachEditor()
    s.act('delete', ['a1'])
    expect(open).toHaveBeenCalledWith('delete', 'artists', ['a1'], 'modal', undefined)
  })

  it('opening the same record again re-loads the form (fresh copy after an outside edit)', () => {
    const { selections } = setup()
    const s = selections.get('artists')
    s.attachEditor()
    s.act('update', ['a1'])
    const before = s.sessionKey.value
    s.act('update', ['a1'])
    expect(s.sessionKey.value).toBe(before + 1)
  })
})
