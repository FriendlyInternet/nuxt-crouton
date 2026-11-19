// The status app's clock (#4133): the Worker's cron (env.staging.triggers in wrangler.jsonc)
// fires `cloudflare:scheduled`; nitro runs this hook inside waitUntil, so returning the promise is enough.
import { onTick } from '../utils/clock-tick'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('cloudflare:scheduled', ({ controller, env }) =>
    onTick(controller.scheduledTime, env as Record<string, unknown>)
  )
})
