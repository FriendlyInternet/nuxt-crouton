import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'

/**
 * Generic, domain-agnostic printing tables (epic #325, issue #326).
 *
 * These are package-owned infra tables (the crouton-flow pattern) — they do NOT
 * go through the `crouton config` collection generator. Any domain package
 * (crouton-sales, crouton-bookings, …) prints by enqueuing a row here; the
 * printing engine + transport then drain and deliver it. The tables deliberately
 * know nothing about "orders" or "bookings": the domain is carried by a `source`
 * discriminator and an opaque `refType`/`refId` back-reference, and the content
 * to print is an opaque `payload` (base64 ESC/POS for thermal, JSON for
 * browser-print). That opacity is what lets multiple domains share one queue.
 *
 * NuxtHub auto-discovers these via `server/db/schema.ts`, which re-exports them.
 */

/**
 * A configured physical (or virtual) printer. One row per printer at a venue.
 *
 * `source` records which domain package owns/created the row so a shared venue
 * can be filtered per domain if needed; `driver` selects the output path
 * (`network-escpos` raw TCP, `browser-print` AirPrint/HTML, future serial/usb).
 */
export const printers = sqliteTable('printers', {
  id: text('id').primaryKey().$default(() => nanoid()),
  // Domain that owns this printer ('sales' | 'bookings' | …).
  source: text('source').notNull().$default(() => 'sales'),
  // Correlation (optional — domains scope printers however they like).
  teamId: text('team_id'),
  eventId: text('event_id'),
  // Routing key for kitchen-style printers (receipt printers ignore it).
  locationId: text('location_id'),
  title: text('title').notNull(),
  // Output driver: 'network-escpos' (default) | 'browser-print' | future serial/usb.
  driver: text('driver').notNull().$default(() => 'network-escpos'),
  // Transport address for network drivers.
  ipAddress: text('ip_address'),
  port: integer('port').notNull().$default(() => 9100),
  // Domain-meaningful classification ('kitchen' | 'receipt' | …).
  type: text('type'),
  // Live device status: 0=ready, 1=printing, 9=error.
  status: integer('status').notNull().$default(() => 0),
  showPrices: integer('show_prices', { mode: 'boolean' }).notNull().$default(() => true),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().$default(() => true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()).$onUpdate(() => new Date()),
}, table => [
  index('idx_printers_source').on(table.source),
  index('idx_printers_event').on(table.eventId),
  index('idx_printers_location').on(table.locationId),
])

/**
 * One print job per ticket. The unit the transport drains and delivers.
 *
 * Status is text to match the existing on-site spooler contract:
 * '0'=pending, '1'=printing, '2'=done, '9'=error. `payload` is opaque (encoded
 * by the domain via the engine). `refType`/`refId` point back at the domain
 * entity that produced the job (e.g. 'order'/<orderId>, 'booking'/<bookingId>)
 * without this package needing to know what those are.
 */
export const printJobs = sqliteTable('print_jobs', {
  id: text('id').primaryKey().$default(() => nanoid()),
  // Domain that produced the job ('sales' | 'bookings' | …) — the discriminator.
  source: text('source').notNull().$default(() => 'sales'),
  // Opaque printer reference — used for grouping/status (LEDs per printer). The
  // job does NOT join a printers table: the transport is fully self-contained.
  printerId: text('printer_id').notNull(),
  // Denormalized printer transport details, copied onto the job at enqueue time
  // so the transport (drainer/spooler) needs no domain printer table. Null for
  // drivers that don't address a network device (e.g. browser-print).
  printerIp: text('printer_ip'),
  printerPort: integer('printer_port').notNull().$default(() => 9100),
  printerTitle: text('printer_title'),
  locationId: text('location_id'),
  teamId: text('team_id'),
  eventId: text('event_id'),
  // Opaque back-reference to the domain entity (no FK — domain-owned).
  refType: text('ref_type'),
  refId: text('ref_id'),
  // Output driver the transport should use for this job.
  driver: text('driver').notNull().$default(() => 'network-escpos'),
  // '0'=pending | '1'=printing | '2'=done | '9'=error.
  status: text('status').notNull().$default(() => '0'),
  // Opaque encoded ticket: base64 ESC/POS for thermal, JSON for browser-print.
  payload: text('payload').notNull(),
  printMode: text('print_mode').notNull().$default(() => 'normal'),
  errorMessage: text('error_message'),
  // Text to match the spooler's COALESCE(retryCount,0)+1 increment contract.
  retryCount: text('retry_count').notNull().$default(() => '0'),
  // ISO timestamp string (toISOString), not a date column — spooler contract.
  completedAt: text('completed_at'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()).$onUpdate(() => new Date()),
}, table => [
  // Drain query: pending jobs for a driver/event, oldest first.
  index('idx_print_jobs_drain').on(table.status, table.driver, table.eventId),
  index('idx_print_jobs_printer').on(table.printerId),
  index('idx_print_jobs_ref').on(table.refType, table.refId),
  index('idx_print_jobs_source').on(table.source),
])

/**
 * Per-event transport selection for `network-escpos` jobs (#1324).
 *
 * Historically WHICH transport delivers thermal jobs — the in-process TCP
 * drainer on the venue Pi vs the on-site router spooler polling over HTTP —
 * was decided by ops artifacts (an env var on the Pi, an event id hardcoded in
 * the RUT956 script), and "run either one, never both" was only a comment.
 * This row makes the choice per-event data, enforced at both drain points.
 *
 * NO ROW = legacy behaviour (both transports allowed) so existing rigs are
 * untouched; a row makes the choice exclusive. `transport = 'none'` parks the
 * event: jobs stay pending, nobody delivers. `browser-print` jobs are not
 * governed by this — that driver is chosen per printer.
 *
 * The heartbeat columns are a liveness readout for the settings UI ("spooler
 * last seen 4s ago"): each transport stamps its own column (throttled) when it
 * polls/ticks. ISO-text timestamps, same convention as print_jobs.completedAt.
 *
 * `eventId` stays an opaque correlation key (like on printers/print_jobs) —
 * this package still knows nothing about what an event is. This is a config
 * entity: when bidirectional config sync (#802) lands, it should sync with it.
 */
export const printTransports = sqliteTable('print_transports', {
  eventId: text('event_id').primaryKey(),
  teamId: text('team_id'),
  // 'local-drainer' | 'router-spooler' | 'none' (see PRINT_TRANSPORT).
  transport: text('transport').notNull().$default(() => 'router-spooler'),
  lastSpoolerPollAt: text('last_spooler_poll_at'),
  lastDrainerTickAt: text('last_drainer_tick_at'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()).$onUpdate(() => new Date()),
})
