import { defineNuxtPlugin } from 'nuxt/app'
import BuilderToolbarBlock from '~/components/BuilderToolbarBlock.vue'
import BuilderNavBlock from '~/components/BuilderNavBlock.vue'
import BuilderSpacer from '~/components/BuilderSpacer.vue'
import BuilderGhostPane from '~/components/BuilderGhostPane.vue'

/**
 * Register the app's chrome layout-block components GLOBALLY.
 *
 * `CroutonLayoutRenderer` resolves a leaf's block to a component by NAME via
 * `<component :is="block.component">`; a runtime-string `:is` only resolves
 * GLOBALLY-registered components (Nuxt's per-file auto-import does not make a name
 * resolvable that way). The package's own blocks (CroutonLayoutCollection etc.) are
 * already global; these app-owned ones must be registered here so the registry's
 * `component: 'BuilderToolbarBlock'` (etc.) resolves in the renderer.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component('BuilderToolbarBlock', BuilderToolbarBlock)
  nuxtApp.vueApp.component('BuilderNavBlock', BuilderNavBlock)
  nuxtApp.vueApp.component('BuilderSpacer', BuilderSpacer)
  nuxtApp.vueApp.component('BuilderGhostPane', BuilderGhostPane)
})
