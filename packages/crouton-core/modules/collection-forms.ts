import { addTemplate, addTypeTemplate, defineNuxtModule } from '@nuxt/kit'

/**
 * Build-time map of every `*Form` / `*Detail` / `*Select` component → its lazy component.
 *
 * FormDynamicLoader resolves a collection's form by canonical name
 * (`<Layer><Plural>Form`). Doing that through the runtime component registry
 * forces every form to be registered globally (and into the entry chunk). This
 * map is built from Nuxt's *final* component list (`components:extend`), so the
 * app-beats-layer winner is Nuxt's own — ejecting a form is still "add one file".
 * `*Select` covers generated dependent-field selects (`<Layer><Plural><Field>Select`),
 * looked up by FormDependentFieldLoader the same way.
 * Each value is Nuxt's `Lazy<Name>` export from `#components`, a real lazy chunk.
 */

export const COLLECTION_FORMS_TEMPLATE = 'crouton-collection-forms.mjs'

const isFormOrDetail = (name: string) => /(Form|Detail|Select)$/.test(name)

/** Render the template source for a list of resolved component names. */
export function renderCollectionForms(pascalNames: string[]): string {
  const names = [...new Set(pascalNames.filter(isFormOrDetail))].sort()
  const imports = names.map(n => `  Lazy${n},`).join('\n')
  const entries = names.map(n => `  ${n}: Lazy${n},`).join('\n')
  return [
    names.length ? `import {\n${imports}\n} from '#components'` : '',
    `export const collectionForms = {\n${entries}\n}`,
    'export default collectionForms',
    ''
  ].filter((l, i) => i || l).join('\n')
}

export default defineNuxtModule({
  meta: { name: 'crouton-core:collection-forms' },
  setup (_options, nuxt) {
    let names: string[] = []

    nuxt.hook('components:extend', (components) => {
      names = components.map(c => c.pascalName)
    })

    addTemplate({
      filename: COLLECTION_FORMS_TEMPLATE,
      write: true,
      getContents: () => renderCollectionForms(names)
    })
    addTypeTemplate({
      filename: 'types/crouton-collection-forms.d.ts',
      getContents: () => [
        `declare module '#build/${COLLECTION_FORMS_TEMPLATE}' {`,
        '  export const collectionForms: Record<string, import(\'vue\').Component>',
        '  export default collectionForms',
        '}',
        ''
      ].join('\n')
    })
  }
})
