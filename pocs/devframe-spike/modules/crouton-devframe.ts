import { defineNuxtModule, createResolver, addServerHandler } from '@nuxt/kit'
import { onDevtoolsReady } from '@nuxt/devtools-kit'

export default defineNuxtModule({
  meta: { name: 'crouton-devframe' },
  setup(_options, nuxt) {
    // Dev-only: no devframe code is registered for a production build.
    if (!nuxt.options.dev) return
    const { resolve } = createResolver(import.meta.url)

    ;(nuxt.options.runtimeConfig as any).croutonDevframe = {
      distDir: resolve('../devframe-client-dist')
    }

    // NOT server/plugins/ and NOT addServerPlugin: registered here, in dev only.
    nuxt.hook('nitro:config', (c: any) => {
      c.plugins ||= []
      c.plugins.push(resolve('../server/devframe/plugin'))
    })

    addServerHandler({ route: '/__crouton_df/**', handler: resolve('../server/devframe/handler') })

    onDevtoolsReady((ctx: any) => {
      ctx.docks.register({
        id: 'crouton-df',
        title: 'Crouton (Devframe)',
        icon: 'carbon:data-table',
        type: 'iframe',
        url: '/__crouton_df/'
      })
    })
  }
})
