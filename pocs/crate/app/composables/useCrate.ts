// Crate deck state (#2208): the pile tree, the library, and filing tracks into piles.
// A pile IS a comment tag. Filing into a pile also files into every ancestor; taking a track
// out of a pile also takes it out of everything inside that pile.

export interface CratePile { id: string, name: string, parentId: string | null, order: number }
export interface CrateTrack {
  id: string
  name: string
  artist: string | null
  genre: string | null
  year: number | null
  bpm: number | null
  tonality: string | null
  durationSec: number | null
  hasAudio: boolean
  /** Uploaded into crate (#2237), not yet in rekordbox — can be renamed or deleted here. */
  uploaded?: boolean
  tags: string[]
}

/** "Not tagged yet" — the inbox: no tags at all, or only the NEW marker. */
export const NEW_TAG = 'NEW'
const isInbox = (t: CrateTrack) => t.tags.every(tag => tag === NEW_TAG)
/** "Checked in crate" (#2237): the owner confirmed this track's tags with ✓ Done. Lives in Comments,
 *  so rekordbox can tell which tracks went through crate and which still need a look. */
export const CHECKED_TAG = 'crateapp'
export const isChecked = (t: CrateTrack) => t.tags.includes(CHECKED_TAG)
/** Which tracks wait at the top level: the untagged inbox, or everything not yet checked in crate. */
export type TopTray = 'inbox' | 'unchecked' | 'uploads'

export function useCrate() {
  const { getTeamId } = useTeamContext()
  const toast = useToast()
  const api = (path: string) => `/api/teams/${getTeamId()}/crate${path}`

  // Browser-only: the library is ~6.5k tracks — too big to inline into server-rendered HTML —
  // and the team id is only known once the session has loaded.
  const { data, status, refresh } = useFetch<{ piles: CratePile[], tracks: CrateTrack[] }>(() => api('/library'), {
    server: false,
    immediate: !!getTeamId(),
    watch: [() => getTeamId()],
    default: () => ({ piles: [], tracks: [] }),
    // Tags are edited in place on the track objects, so the payload must be deeply reactive.
    deep: true
  })
  const piles = computed(() => data.value.piles)
  const tracks = computed(() => data.value.tracks)

  // ── Tree ────────────────────────────────────────────────────────────────
  const pileById = computed(() => new Map(piles.value.map(p => [p.id, p])))
  const pileByName = computed(() => new Map(piles.value.map(p => [p.name.toLowerCase(), p])))
  const childrenOf = computed(() => {
    const map = new Map<string | null, CratePile[]>()
    for (const p of piles.value) map.set(p.parentId, [...(map.get(p.parentId) ?? []), p])
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  })
  const children = (id: string | null) => childrenOf.value.get(id) ?? []
  const ancestors = (pile: CratePile): CratePile[] => {
    const out: CratePile[] = []
    for (let p = pile.parentId ? pileById.value.get(pile.parentId) : undefined; p; p = p.parentId ? pileById.value.get(p.parentId) : undefined) out.unshift(p)
    return out
  }
  const descendants = (pile: CratePile): CratePile[] => children(pile.id).flatMap(c => [c, ...descendants(c)])
  const pathLabel = (pile: CratePile) => [...ancestors(pile), pile].map(p => p.name).join(' › ')

  // ── Membership ──────────────────────────────────────────────────────────
  const pileOfTag = (tag: string) => pileByName.value.get(tag.toLowerCase())
  /** Pile ids a track counts towards: each tagged pile plus its ancestors. */
  const pilesOfTrack = (t: CrateTrack) => {
    const ids = new Set<string>()
    for (const tag of t.tags) {
      const p = pileOfTag(tag)
      if (!p) continue
      ids.add(p.id)
      ancestors(p).forEach(a => ids.add(a.id))
    }
    return ids
  }
  const membership = computed(() => new Map(tracks.value.map(t => [t.id, pilesOfTrack(t)])))
  const counts = computed(() => {
    const c = new Map<string, number>()
    for (const ids of membership.value.values()) ids.forEach(id => c.set(id, (c.get(id) ?? 0) + 1))
    return c
  })
  const isIn = (t: CrateTrack, pile: CratePile) => membership.value.get(t.id)?.has(pile.id) ?? false
  /** The deepest piles a track is in — what the "In:" row shows as full paths. */
  const leafPiles = (t: CrateTrack) => piles.value.filter(p => isIn(t, p) && !children(p.id).some(c => isIn(t, c)))
  const otherTags = (t: CrateTrack) => t.tags.filter(tag => tag !== NEW_TAG && tag !== CHECKED_TAG && !pileOfTag(tag))

  /** Tracks waiting at a level: at the top the inbox (or, in "unchecked" mode, every track not yet
   *  checked in crate), else tracks in the pile but in none of its sub-piles. */
  const tray = (level: CratePile | null, top: TopTray = 'inbox') => level
    ? tracks.value.filter(t => isIn(t, level) && !children(level.id).some(c => isIn(t, c)))
    : tracks.value.filter(t => top === 'inbox' ? isInbox(t) : top === 'uploads' ? !!t.uploaded : !isChecked(t))

  // ── Writes (optimistic, recorded server-side for undo) ──────────────────
  function setLocalTags(trackId: string, tags: string[]) {
    const t = tracks.value.find(x => x.id === trackId)
    if (t) t.tags = tags
  }

  async function saveTags(track: CrateTrack, tags: string[], summary: string) {
    const previous = track.tags
    setLocalTags(track.id, tags)
    try {
      await $fetch(api(`/tracks/${track.id}/tags`), { method: 'POST', body: { tags, summary } })
      toast.add({ title: summary, duration: 4000, actions: [{ label: 'Undo', onClick: () => { undo() } }] })
    }
    catch (error) {
      setLocalTags(track.id, previous)
      toast.add({ title: 'Couldn’t save', description: String((error as Error).message ?? error), color: 'error' })
    }
  }

  function fileInto(track: CrateTrack, pile: CratePile) {
    const add = [...ancestors(pile), pile].map(p => p.name).filter(n => !track.tags.some(t => t.toLowerCase() === n.toLowerCase()))
    return saveTags(track, [...track.tags.filter(t => t !== NEW_TAG), ...add], `${track.name}: + ${pathLabel(pile)}`)
  }

  function takeOutOf(track: CrateTrack, pile: CratePile) {
    const drop = new Set([pile, ...descendants(pile)].map(p => p.name.toLowerCase()))
    return saveTags(track, track.tags.filter(t => !drop.has(t.toLowerCase())), `${track.name}: − ${pathLabel(pile)}`)
  }

  const toggle = (track: CrateTrack, pile: CratePile) => isIn(track, pile) ? takeOutOf(track, pile) : fileInto(track, pile)

  /** ✓ Done: mark the track as checked in crate (drops NEW). Already checked → nothing to save. */
  function markChecked(track: CrateTrack) {
    if (isChecked(track)) return
    return saveTags(track, [...track.tags.filter(t => t !== NEW_TAG), CHECKED_TAG], `${track.name}: ✓ checked`)
  }

  async function undo() {
    try {
      const res = await $fetch<{ groupId: string | null, tracks: { trackId: string, tags: string[] }[] }>(api('/undo'), { method: 'POST' })
      if (!res.groupId) return toast.add({ title: 'Nothing to undo' })
      res.tracks.forEach(w => setLocalTags(w.trackId, w.tags))
      toast.add({ title: 'Undone', duration: 2500 })
    }
    catch (error) {
      toast.add({ title: 'Undo failed', description: String((error as Error).message ?? error), color: 'error' })
    }
  }

  const audioUrl = (t: CrateTrack) => api(`/tracks/${t.id}/audio`)

  /** A freshly uploaded track (#2237) joins the library without a reload. */
  const addTrack = (track: CrateTrack) => data.value.tracks.push(track)

  /** Rename an upload (artist + title). Returns false when the server refused. */
  async function renameUpload(track: CrateTrack, artist: string, name: string) {
    try {
      await $fetch(api(`/uploads/tracks/${track.id}`), { method: 'PATCH', body: { artist, name } })
      Object.assign(track, { artist: artist || null, name })
      toast.add({ title: 'Renamed', duration: 2500 })
      return true
    }
    catch (error) {
      toast.add({ title: 'Couldn’t rename', description: String((error as Error).message ?? error), color: 'error' })
      return false
    }
  }

  /** Delete an upload: the file, the track and its history. */
  async function deleteUpload(track: CrateTrack) {
    try {
      await $fetch(api(`/uploads/tracks/${track.id}`), { method: 'DELETE' })
      data.value.tracks = data.value.tracks.filter(t => t.id !== track.id)
      toast.add({ title: `Deleted ${track.name}`, duration: 2500 })
      return true
    }
    catch (error) {
      toast.add({ title: 'Couldn’t delete', description: String((error as Error).message ?? error), color: 'error' })
      return false
    }
  }

  /** Create a pile (optionally inside another) and, if given, file `track` into it. */
  async function createPile(name: string, parentId: string | null, track: CrateTrack | null) {
    try {
      const pile = await $fetch<CratePile>(`/api/teams/${getTeamId()}/crate-piles`, { method: 'POST', body: { name, parentId } })
      data.value.piles.push({ id: pile.id, name: pile.name, parentId: pile.parentId ?? null, order: pile.order ?? 0 })
      if (track) await fileInto(track, data.value.piles.at(-1)!)
      return pile
    }
    catch (error) {
      toast.add({ title: 'Couldn’t create the pile', description: String((error as Error).message ?? error), color: 'error' })
      return null
    }
  }

  return { api, status, refresh, piles, tracks, children, ancestors, descendants, pathLabel, counts, isIn, leafPiles, otherTags, tray, toggle, fileInto, takeOutOf, undo, audioUrl, addTrack, renameUpload, deleteUpload, markChecked, createPile }
}
