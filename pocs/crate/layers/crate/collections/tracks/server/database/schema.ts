import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, real, customType, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Custom JSON column that handles NULL values gracefully during LEFT JOINs
const jsonColumn = customType<any>({
  dataType() {
    return 'text'
  },
  fromDriver(value: unknown): any {
    if (value === null || value === undefined || value === '') {
      return null
    }
    try {
      return JSON.parse(value as string)
    } catch {
      return null
    }
  },
  toDriver(value: any): string {
    return JSON.stringify(value)
  },
})

export const crateTracks = sqliteTable('crate_tracks', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  rekordboxId: text('rekordboxId').notNull(),
  name: text('name').notNull(),
  artist: text('artist'),
  album: text('album'),
  genre: text('genre'),
  year: integer('year'),
  bpm: real('bpm'),
  tonality: text('tonality'),
  durationSec: integer('durationSec'),
  label: text('label'),
  dateAdded: integer('dateAdded', { mode: 'timestamp' }).$default(() => new Date()),
  location: text('location').notNull(),
  audioPath: text('audioPath'),
  tags: jsonColumn('tags').$default(() => (null)),
  originalComments: text('originalComments'),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
}, (table) => [
  uniqueIndex('crate_tracks_team_rekordbox_id_idx').on(table.teamId, table.rekordboxId)
])