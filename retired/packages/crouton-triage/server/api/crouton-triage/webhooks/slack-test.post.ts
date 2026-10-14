/**
 * MINIMAL TEST ENDPOINT
 * No imports, just basic logging to test if route works
 */

import { logger } from '../../../utils/logger'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  logger.debug('========== SLACK TEST ENDPOINT HIT ==========')
  logger.debug('Method', { method: event.method })
  logger.debug('Path', { path: event.path })
  logger.debug('Headers', { headers: getHeaders(event) })

  const body = await readBody(event)
  logger.debug('Body', { body: JSON.stringify(body) })

  // If it's URL verification, respond
  if (body && body.type === 'url_verification') {
    logger.debug('URL verification challenge received', { challenge: body.challenge })
    return { challenge: body.challenge }
  }

  return {
    success: true,
    message: 'Test endpoint reached!',
    timestamp: new Date().toISOString()
  }
})