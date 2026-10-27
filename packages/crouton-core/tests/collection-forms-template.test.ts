import { describe, expect, it } from 'vitest'
import { renderCollectionForms } from '../modules/collection-forms'

describe('renderCollectionForms', () => {
  it('keeps only Form/Detail/Select components, each as its Lazy export from #components', () => {
    const src = renderCollectionForms(['BookingsLocationsForm', 'CroutonDetail', 'UButton', 'CroutonTable'])
    expect(src).toContain('LazyBookingsLocationsForm')
    expect(src).toContain('CroutonDetail: LazyCroutonDetail')
    expect(src).toContain("from '#components'")
    expect(src).not.toContain('UButton')
    expect(src).not.toContain('CroutonTable')
  })

  it('dedupes and sorts names so the output is stable', () => {
    const src = renderCollectionForms(['BFoo' + 'Form', 'AFooForm', 'BFooForm'])
    expect(src.match(/BFooForm: /g)).toHaveLength(1)
    expect(src.indexOf('AFooForm: ')).toBeLessThan(src.indexOf('BFooForm: '))
  })

  it('emits a valid empty map when nothing matches', () => {
    const src = renderCollectionForms(['UButton'])
    expect(src).not.toContain('#components')
    expect(src).toContain('export const collectionForms = {')
  })
})
