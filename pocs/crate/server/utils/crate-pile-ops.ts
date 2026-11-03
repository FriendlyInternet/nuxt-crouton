// Managing piles (#2211): rename, move, remove and reorder — worked out here as plain data, so the
// endpoints only load, apply and record. A pile IS a tag, and a track filed into a pile also carries
// every ancestor's tag, so some pile edits rewrite track tags too.

export interface PileSnap { name: string, parentId: string | null, order: number }
export interface PileRow extends PileSnap { id: string }
export interface TrackRow { id: string, tags: string[] }

/** One pile's new state (`null` = the pile is removed). */
export interface PileWrite { pileId: string, after: PileSnap | null }
export interface TagWrite { trackId: string, tags: string[] }
export interface PilePlan { piles: PileWrite[], tracks: TagWrite[], summary: string }

export class PileOpError extends Error {}

const lower = (s: string) => s.toLowerCase()
const snap = (p: PileRow): PileSnap => ({ name: p.name, parentId: p.parentId, order: p.order })

function tree(piles: PileRow[]) {
  const byId = new Map(piles.map(p => [p.id, p]))
  const ancestors = (p: PileRow) => {
    const out: PileRow[] = []
    for (let a = p.parentId ? byId.get(p.parentId) : undefined; a; a = a.parentId ? byId.get(a.parentId) : undefined) out.unshift(a)
    return out
  }
  const subtree = (p: PileRow): PileRow[] => [p, ...piles.filter(c => c.parentId === p.id).flatMap(subtree)]
  const siblings = (parentId: string | null) => piles.filter(p => p.parentId === parentId).sort((a, b) => a.order - b.order)
  const get = (id: string) => {
    const p = byId.get(id)
    if (!p) throw new PileOpError('Pile not found')
    return p
  }
  const label = (p: PileRow) => [...ancestors(p), p].map(a => a.name).join(' › ')
  return { byId, ancestors, subtree, siblings, get, label }
}

/** Dedupe case-insensitively, keeping the first spelling and the order. */
function uniq(tags: string[]) {
  const seen = new Set<string>()
  return tags.filter(t => !seen.has(lower(t)) && seen.add(lower(t)))
}
const changed = (a: string[], b: string[]) => a.length !== b.length || a.some((t, i) => t !== b[i])

/** Rename a pile and the tag on every track that has it — one undoable step. */
export function planRename(piles: PileRow[], tracks: TrackRow[], pileId: string, newName: string): PilePlan {
  const t = tree(piles)
  const pile = t.get(pileId)
  const name = newName.trim()
  if (!name) throw new PileOpError('A pile needs a name')
  if (name.includes(',')) throw new PileOpError('A pile name cannot contain a comma (rekordbox splits tags on it)')
  if (piles.some(p => p.id !== pileId && lower(p.name) === lower(name))) throw new PileOpError(`There is already a pile called "${name}"`)

  const old = lower(pile.name)
  const writes: TagWrite[] = []
  for (const track of tracks) {
    if (!track.tags.some(tag => lower(tag) === old)) continue
    const tags = uniq(track.tags.map(tag => lower(tag) === old ? name : tag))
    if (changed(track.tags, tags)) writes.push({ trackId: track.id, tags })
  }
  return { piles: [{ pileId, after: { ...snap(pile), name } }], tracks: writes, summary: `Rename ${pile.name} → ${name}` }
}

/**
 * Put a pile inside another (or at the top level, `newParentId = null`), as the last one there.
 * Tracks in the moved pile get the new ancestors' tags and lose old ancestors' tags that nothing
 * else they're in still needs — so filtering on the parent in rekordbox keeps matching the tree.
 */
export function planMove(piles: PileRow[], tracks: TrackRow[], pileId: string, newParentId: string | null): PilePlan {
  const t = tree(piles)
  const pile = t.get(pileId)
  if (pile.parentId === newParentId) throw new PileOpError('The pile is already there')
  const moved = t.subtree(pile)
  if (newParentId && moved.some(p => p.id === newParentId)) throw new PileOpError('A pile cannot go inside itself')
  const parent = newParentId ? t.get(newParentId) : null

  const order = Math.max(-1, ...t.siblings(newParentId).map(p => p.order)) + 1
  const after = piles.map(p => p.id === pileId ? { ...p, parentId: newParentId, order } : p)
  const t2 = tree(after)

  const movedNames = new Set(moved.map(p => lower(p.name)))
  const oldAncestors = t.ancestors(pile).map(p => p.name)
  const oldAncestorKeys = new Set(oldAncestors.map(lower))
  const newAncestors = parent ? [...t.ancestors(parent), parent].map(p => p.name) : []
  const pileByName = new Map(after.map(p => [lower(p.name), p]))

  const writes: TagWrite[] = []
  for (const track of tracks) {
    if (!track.tags.some(tag => movedNames.has(lower(tag)))) continue
    // Every ancestor tag the track still needs after the move, from every pile it is in.
    // Old ancestors' own tags don't count as a reason: they are what's being questioned.
    const needed = new Set<string>()
    for (const tag of track.tags) {
      if (oldAncestorKeys.has(lower(tag))) continue
      const p = pileByName.get(lower(tag))
      if (p) t2.ancestors(p).forEach(a => needed.add(lower(a.name)))
    }
    // An old ancestor's tag stays only if another pile the track is in still needs it. A track in a
    // sub-pile is never "loose" in the parent, so that tag came from the ancestor rule.
    const drop = new Set([...oldAncestorKeys].filter(n => !needed.has(n)))
    const kept = track.tags.filter(tag => !drop.has(lower(tag)))
    const tags = uniq([...kept, ...newAncestors.filter(n => !kept.some(k => lower(k) === lower(n)))])
    if (changed(track.tags, tags)) writes.push({ trackId: track.id, tags })
  }
  const where = parent ? `into ${t.label(parent)}` : 'to the top level'
  return { piles: [{ pileId, after: { ...snap(pile), parentId: newParentId, order } }], tracks: writes, summary: `Move ${pile.name} ${where}` }
}

/** Move a pile up to its parent's level, right after its old parent. */
export function planMoveUp(piles: PileRow[], tracks: TrackRow[], pileId: string): PilePlan {
  const t = tree(piles)
  const pile = t.get(pileId)
  if (!pile.parentId) throw new PileOpError('The pile is already at the top level')
  return planMove(piles, tracks, pileId, t.get(pile.parentId).parentId)
}

/** Swap a pile with its neighbour (`-1` = earlier, `1` = later). Tags don't change. */
export function planShift(piles: PileRow[], pileId: string, dir: -1 | 1): PilePlan {
  const t = tree(piles)
  const pile = t.get(pileId)
  const list = t.siblings(pile.parentId)
  const at = list.findIndex(p => p.id === pileId)
  const other = list[at + dir]
  if (!other) throw new PileOpError(dir < 0 ? 'Already first' : 'Already last')
  // Renumber the whole level so equal/duplicate orders can't make the swap a no-op.
  const order = list.map(p => p.id)
  ;[order[at], order[at + dir]] = [order[at + dir]!, order[at]!]
  const piles2: PileWrite[] = order.flatMap((id, i) => {
    const p = t.get(id)
    return p.order === i ? [] : [{ pileId: id, after: { ...snap(p), order: i } }]
  })
  return { piles: piles2, tracks: [], summary: `Move ${pile.name} ${dir < 0 ? 'earlier' : 'later'}` }
}

/**
 * Remove a pile. Tracks keep the tag (it becomes a plain tag on them); the piles inside it move up
 * into its place, so nothing below disappears.
 */
export function planRemove(piles: PileRow[], pileId: string): PilePlan {
  const t = tree(piles)
  const pile = t.get(pileId)
  const kids = t.siblings(pile.id)
  const level = t.siblings(pile.parentId).filter(p => p.id !== pileId)
  const at = t.siblings(pile.parentId).findIndex(p => p.id === pileId)
  const order = [...level.slice(0, at), ...kids, ...level.slice(at)]
  const writes: PileWrite[] = order.flatMap((p, i) => p.order === i && p.parentId === pile.parentId
    ? []
    : [{ pileId: p.id, after: { ...snap(p), parentId: pile.parentId, order: i } }])
  return { piles: [...writes, { pileId, after: null }], tracks: [], summary: `Remove pile ${pile.name}` }
}
