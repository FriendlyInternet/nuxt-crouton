// GitHub repo webhook (#4309): marks "something changed on GitHub" so the next clock tick syncs the
// inbox. Signed with the Worker secret GITHUB_WEBHOOK_SECRET; rules in server/utils/webhook-core.ts.
// No session needed (GitHub sends no cookie); never calls GitHub or runs the sync itself.
import { handleWebhook } from '../../utils/webhook-core'

export default defineEventHandler(async (event) => {
  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const env = (event.context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare?.env
  const secret = String(env?.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || '')
  const repo = String(useRuntimeConfig(event).githubRepo || 'FriendlyInternet/nuxt-crouton')
  const { status } = await handleWebhook({
    headers: getRequestHeaders(event),
    rawBody,
    secret,
    repo,
    store: useStorage('kv')
  })
  setResponseStatus(event, status)
  return null
})
