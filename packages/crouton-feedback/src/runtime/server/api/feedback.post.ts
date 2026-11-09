import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { formatAnnotationMarkdown, type Annotation } from '../../overlay/capture'
import { resolveSink, registeredSinks } from '../sinks'
import type { FeedbackServerConfig } from '../sinks/types'

/**
 * Feedback dispatcher — `POST /api/_feedback`.
 *
 * Receives an `Annotation` from the Annotate tool, renders it to Markdown, then
 * hands both to the configured sink (webhook / slack / discord / github). The
 * sink decides where it lands; this handler only validates + dispatches.
 *
 * Config comes from server `runtimeConfig.croutonFeedback`, populated at runtime
 * from env so no credential ships in the bundle or reaches the client. Returns
 * `{ data, error }`; on failure `error` is a safe message that never echoes a
 * token or secret.
 */
type FeedbackBody = Partial<Annotation>

/**
 * PR-preview guard (#3162). When the GitHub bridge is wired (`githubPr` set) the
 * overlay is public, so anyone could post into the PR thread. Accept only a
 * signed-in user whose email is on the preview's reviewer list AND verified —
 * the review address is predictable and sign-up leaves `emailVerified` false, so
 * only the deploy seed (or a clicked magic link) can produce a verified one.
 * Fails closed: any missing piece refuses. Non-PR sinks are the app owner's own.
 */
async function reviewerGuard(event: any, config: FeedbackServerConfig): Promise<string | null> {
  const reviewers = String(config.reviewerEmails || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  if (!reviewers.length) return 'no reviewerEmails configured'
  let user: { email?: string, emailVerified?: boolean } | undefined
  try {
    const mod: any = await import('@fyit/crouton-auth/server/utils/useServerAuth')
    const session = await mod.getServerSession(event)
    user = session?.user
  }
  catch {
    return 'auth unavailable'
  }
  if (!user?.email) return 'no session'
  if (user.emailVerified !== true) return 'email not verified'
  if (!reviewers.includes(String(user.email).toLowerCase())) return 'not a reviewer'
  return null
}

export default defineEventHandler(async (event) => {
  // Cast at the boundary: the monorepo resolves two h3 versions, so the H3Event
  // from defineEventHandler isn't nominally identical to useRuntimeConfig's.
  const config = (useRuntimeConfig(event as Parameters<typeof useRuntimeConfig>[0])
    .croutonFeedback || {}) as FeedbackServerConfig

  if (config.githubPr) {
    const refusal = await reviewerGuard(event, config)
    if (refusal) {
      console.warn(`[crouton-feedback] refused feedback post: ${refusal}`)
      setResponseStatus(event, 401)
      return { data: null, error: 'Not authorised' }
    }
  }

  let body: FeedbackBody
  try {
    body = await readBody<FeedbackBody>(event)
  }
  catch {
    return { data: null, error: 'Invalid request body' }
  }

  if (!body?.commentText || !body?.route || !body?.cssSelector) {
    return { data: null, error: 'Missing required fields (commentText, route, cssSelector)' }
  }

  const sinkName = config.sink || 'webhook'
  const sink = resolveSink(sinkName)
  if (!sink) {
    return {
      data: null,
      error: `Unknown feedback sink '${sinkName}'. Available: ${registeredSinks().join(', ')}.`
    }
  }

  const markdown = formatAnnotationMarkdown(body as Annotation)

  try {
    const result = await sink(body as Annotation, markdown, { config, event })
    return result.ok
      ? { data: { ok: true, ...(result.data ?? {}) }, error: null }
      : { data: null, error: result.error || 'Feedback was not sent' }
  }
  catch {
    // A sink threw unexpectedly — never surface internals.
    return { data: null, error: 'Feedback dispatch failed' }
  }
})
