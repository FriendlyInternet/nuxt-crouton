// A Nitro task: the app registers it by handler path (nitro.tasks), so nothing imports it.
// fallow-ignore-file unused-file
/**
 * Daily reminder / follow-up emails (#3930).
 *
 * The package ships this task but never schedules it: an app opts in from its
 * own nuxt.config.ts, under `$production` on a Cloudflare preset only (never in
 * `nuxt dev`), plus a matching `triggers.crons` in wrangler.jsonc. See apps/velo.
 */
import { runScheduledBookingEmails } from '../../utils/scheduled-emails'

export default defineTask({
  meta: {
    name: 'bookings:scheduled-emails',
    description: 'Send due booking reminders and follow-ups'
  },
  async run() {
    const tz = (useRuntimeConfig() as any).croutonBookings?.timezone || 'Europe/Brussels'
    const result = await runScheduledBookingEmails({ tz })
    console.info('[booking-email:scheduled] run done', result)
    return { result }
  }
})
