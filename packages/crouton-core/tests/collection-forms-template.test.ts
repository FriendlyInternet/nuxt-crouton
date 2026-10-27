import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COLLECTION_FORMS_TEMPLATE, renderCollectionForms } from '../modules/collection-forms'

describe('renderCollectionForms', () => {
  it('keeps only Form/Detail/Select components, each as its Lazy export from #components', () => {
    const src = renderCollectionForms(['BookingsLocationsForm', 'CroutonDetail', 'UButton', 'CroutonTable'])
    expect(src).toContain('LazyBookingsLocationsForm')
    expect(src).toContain('CroutonDetail: LazyCroutonDetail')
    expect(src).toContain("from '#components'")
    expect(src).not.toContain('UButton')
    expect(src).not.toContain('CroutonTable')
  })

  it('includes <Layer><Plural>List components so lists resolve like forms', () => {
    const src = renderCollectionForms(['BookingsLocationsList', 'UButton'])
    expect(src).toContain('BookingsLocationsList: LazyBookingsLocationsList')
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

  it('template filename matches the #build import the loaders hard-code', () => {
    for (const f of ['FormDynamicLoader.vue', 'FormDependentFieldLoader.vue', 'CollectionViewer.vue']) {
      const src = readFileSync(resolve(__dirname, '../app/components', f), 'utf8')
      expect(src).toContain(`'#build/${COLLECTION_FORMS_TEMPLATE}'`)
    }
  })
})
