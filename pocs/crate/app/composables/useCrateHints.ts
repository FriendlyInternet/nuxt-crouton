// Genre hints for the deck track (#2212): fetched per track, cached by the server's lookups.
import type { CratePile, CrateTrack } from '~/composables/useCrate'

export interface HintWord { word: string, pileId: string | null, parentId: string | null }
export interface HintSource { label: string, url: string | null, words: HintWord[] }
export interface PileScore { pileId: string, score: number, via: string }

export const STRONG = 0.6
export const WEAK = 0.3

export function useCrateHints(crate: ReturnType<typeof useCrate>, track: Ref<CrateTrack | null>) {
  const { data } = useAsyncData(
    () => `crate-hints-${track.value?.id ?? 'none'}`,
    () => track.value ? $fetch<{ sources: HintSource[], scores: PileScore[] }>(crate.api(`/tracks/${track.value.id}/hints`)) : Promise.resolve({ sources: [], scores: [] }),
    { server: false, watch: [() => track.value?.id], default: () => ({ sources: [], scores: [] }) }
  )
  const sources = computed(() => data.value.sources)
  const scoreOf = computed(() => new Map(data.value.scores.map(s => [s.pileId, s])))

  /** A pile glows with the best score of itself or anything inside it. */
  function glow(pile: CratePile): PileScore | null {
    let best: PileScore | null = null
    for (const p of [pile, ...crate.descendants(pile)]) {
      const s = scoreOf.value.get(p.id)
      if (s && s.score > (best?.score ?? 0)) best = s
    }
    return best && best.score >= WEAK ? best : null
  }

  /** Up to 4 one-tap suggestions the track isn't in yet. */
  const suggestions = computed(() => {
    const t = track.value
    if (!t) return []
    return data.value.scores
      .filter(s => s.score >= WEAK)
      .map(s => crate.piles.value.find(p => p.id === s.pileId))
      .filter((p): p is CratePile => !!p && !crate.isIn(t, p))
      .slice(0, 4)
  })

  return { sources, glow, suggestions }
}
