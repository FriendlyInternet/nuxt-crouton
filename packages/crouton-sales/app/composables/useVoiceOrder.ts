/**
 * @crouton-package crouton-sales
 * @description Talk-to-order speech capture (#1429) — wraps the browser's
 * on-device speech recognition (VueUse useSpeechRecognition, Web Speech API)
 * and feeds each final utterance through parseVoiceOrder. Deliberately the
 * ONLY module that touches the STT engine: swapping in a server/AI
 * transcriber later means replacing this file, not the parser or the UI.
 */
import type { MaybeRefOrGetter } from 'vue'
import { parseVoiceOrder, type VoiceOrderProduct, type VoiceOrderParseResult } from '../utils/voice-order'

export interface UseVoiceOrderOptions<T extends VoiceOrderProduct> {
  /** The event's products to match utterances against (reactive). */
  products: MaybeRefOrGetter<T[]>
  /** BCP-47 recognition language. nl-BE default — the kassa locale (#1429). */
  lang?: string
  /** Called once per final utterance with the parsed draft lines. The caller
   * decides what to do (add to cart, surface unmatched) — never auto-submit. */
  onOrder: (result: VoiceOrderParseResult<T>) => void
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

  watch(speech.isFinal, (final) => {
    if (!final) return
    const utterance = speech.result.value?.trim()
    if (!utterance) return
    const parsed = parseVoiceOrder(utterance, toValue(options.products))
    lastResult.value = parsed
    options.onOrder(parsed)
  })

  function start() {
    // Reset the previous utterance so the transcript line starts clean.
    speech.result.value = ''
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
    lastResult,
    start,
    stop: speech.stop,
    toggle
  }
}

export default useVoiceOrder
