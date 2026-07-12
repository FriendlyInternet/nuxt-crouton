/**
 * @crouton-package crouton-sales
 * @description Talk-to-order speech capture (#1429) — wraps the browser's
 * on-device speech recognition (VueUse useSpeechRecognition, Web Speech API)
 * and feeds each final utterance through parseVoiceOrder. Deliberately the
 * ONLY module that touches the STT engine: swapping in a server/AI
 * transcriber later means replacing this file, not the parser or the UI.
 */
import type { MaybeRefOrGetter } from 'vue'
import {
  parseVoiceOrder,
  classifyVoiceError,
  type VoiceOrderProduct,
  type VoiceOrderParseResult,
  type VoiceOrderErrorCode
} from '../utils/voice-order'

export interface UseVoiceOrderOptions<T extends VoiceOrderProduct> {
  /** The event's products to match utterances against (reactive). */
  products: MaybeRefOrGetter<T[]>
  /** BCP-47 recognition language. nl-BE default — the kassa locale (#1429). */
  lang?: string
  /** Called once per final utterance with the parsed draft lines. The caller
   * decides what to do (add to cart, surface unmatched) — never auto-submit. */
  onOrder: (result: VoiceOrderParseResult<T>) => void
  /** Called on a REAL recognition failure (permission/mic/network/language) —
   * benign pauses (no-speech/aborted/no-match) are swallowed and never reach
   * here. The caller shows a reason-specific message. */
  onError?: (code: VoiceOrderErrorCode) => void
}

/**
 * Speech capture for the POS mic button.
 *
 * @example
 * ```ts
 * const voice = useVoiceOrder({
 *   products: () => products.value,
 *   onOrder({ lines, unmatched }) {
 *     for (const line of lines) addToCart(line.product) // × line.quantity
 *   }
 * })
 * // <UButton v-if="voice.isSupported" @click="voice.toggle()" />
 * ```
 */
export function useVoiceOrder<T extends VoiceOrderProduct>(options: UseVoiceOrderOptions<T>) {
  const speech = useSpeechRecognition({
    lang: options.lang ?? 'nl-BE',
    // Interim results drive the live transcript line under the mic button.
    interimResults: true,
    // One utterance per press: recognition ends itself after a pause, so a
    // helper can't leave a hot mic open mid-shift.
    continuous: false
  })

  const lastResult = ref<VoiceOrderParseResult<T> | null>(null)
  /** The last recognition error code (raw), for diagnostics/console — stays
   * set until the next start(). */
  const errorCode = computed<VoiceOrderErrorCode | undefined>(() => {
    // speech.error is Error | SpeechRecognitionErrorEvent — only the recognition
    // event carries a `.error` code; narrow before reading it.
    const err = speech.error.value
    return (err && 'error' in err ? err.error : undefined) as VoiceOrderErrorCode | undefined
  })

  watch(speech.isFinal, (final) => {
    if (!final) return
    const utterance = speech.result.value?.trim()
    if (!utterance) return
    const parsed = parseVoiceOrder(utterance, toValue(options.products))
    lastResult.value = parsed
    options.onOrder(parsed)
  })

  // Route recognition errors via the pure classifier: always log the raw code
  // (the single most useful diagnostic when a helper reports "it just failed"),
  // but only surface real failures — benign pauses (no-speech/aborted/no-match)
  // are swallowed so a mid-rush pause never reads as an error.
  watch(speech.error, (event) => {
    const outcome = classifyVoiceError(event)
    if (!outcome) return
    console.warn(`[voice-order] recognition error: ${outcome.code}`, outcome.message)
    if (outcome.report) options.onError?.(outcome.code)
  })

  function start() {
    // Reset the previous utterance + error so the transcript line and any
    // stale failure state start clean.
    speech.result.value = ''
    speech.error.value = undefined
    speech.start()
  }

  function toggle() {
    if (speech.isListening.value) speech.stop()
    else start()
  }

  return {
    /** False when the browser has no SpeechRecognition — hide the mic. */
    isSupported: speech.isSupported,
    isListening: speech.isListening,
    /** Live (interim) transcript while listening. */
    transcript: speech.result,
    /** The recognition error event, if any (e.g. mic permission denied). */
    error: speech.error,
    /** The last recognition error code (raw string), for diagnostics. */
    errorCode,
    lastResult,
    start,
    stop: speech.stop,
    toggle
  }
}

export default useVoiceOrder
