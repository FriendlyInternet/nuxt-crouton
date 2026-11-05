export default {
  features: {},

  // Crate — tag a rekordbox library into genre piles (epic #2204).
  //   tracks  — one row per rekordbox TRACK; `tags` is the source of truth for Comments
  //   piles   — the pile tree (a pile IS a tag); hierarchy = nesting + order
  //   lookups — cached Discogs/Bandcamp genre hints per track
  //   changes — before/after tags per track, grouped per user action (persistent undo)
  collections: [
    { name: 'tracks', fieldsFile: './schemas/tracks.json' },
    { name: 'piles', fieldsFile: './schemas/piles.json', hierarchy: { enabled: true, parentField: 'parentId', orderField: 'order', pathField: 'path', depthField: 'depth' } },
    { name: 'lookups', fieldsFile: './schemas/lookups.json' },
    { name: 'changes', fieldsFile: './schemas/changes.json' }
  ],

  targets: [
    { layer: 'crate', collections: ['tracks', 'piles', 'lookups', 'changes'] }
  ],

  dialect: 'sqlite'
}
