import { defineEventHandler, toWebRequest, createError } from 'h3'
import { state } from './state'

export default defineEventHandler(async (event) => {
  if (!state.instance) throw createError({ statusCode: 503, statusMessage: 'devframe not ready' })
  return state.instance.handler(toWebRequest(event))
})
