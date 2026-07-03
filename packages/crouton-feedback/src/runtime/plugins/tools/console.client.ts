import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
import { useFeedbackTools } from '../../composables/useFeedbackTools'
import { createConsoleTool } from '../../tools/console'
import { installEarlyConsoleCapture } from '../../tools/console-capture'

/**
 * Registers the Console (eruda) tool and starts the early-capture buffer at page
 * load (#1080), so load / hydration / mount errors — which fire before eruda's
 * lazy init — are still there when you open Console. Also feeds Vue's own error /
 * warn handlers (e.g. "Failed to resolve component") into the buffer, chaining any
 * existing handler. Dev/review-gated, so production ships nothing.
 */
export default defineNuxtPlugin((nuxtApp) => {
  if (!import.meta.client) return
  if (!(import.meta.dev || useRuntimeConfig().public.croutonFeedback)) return

  const capture = installEarlyConsoleCapture()

  const app = nuxtApp.vueApp
  const prevError = app.config.errorHandler
  app.config.errorHandler = (err, instance, info) => {
    capture.record('error', [`[Vue] ${info}`, err])
    prevError?.(err, instance, info)
  }
  const prevWarn = app.config.warnHandler
  app.config.warnHandler = (msg, instance, trace) => {
    capture.record('warn', [`[Vue warn] ${msg}`, trace])
    prevWarn?.(msg, instance, trace)
  }

  // Wire the panel's ✕ to the registry's deactivate so the launcher's active state stays in
  // sync (the tool refers to itself via `toolRef`, assigned before any close click fires).
  const { registerTool, deactivate } = useFeedbackTools()
  const toolRef = createConsoleTool(capture, undefined, () => deactivate(toolRef))
  registerTool(toolRef)
})
