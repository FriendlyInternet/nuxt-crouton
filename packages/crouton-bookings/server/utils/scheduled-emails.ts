/**
 * Scheduled booking emails (#3930)
 *
 * Once a day, send every active `reminder_before` / `follow_up_after` template
 * to the bookings it is due for — `daysOffset` days before / after the booking's
 * local day in the bookings time zone — exactly once per booking + template +
 * customer. The email log is the "already sent" record: any existing row for
 * that booking, template and recipient (sent, pending or failed, including a
 * manual resend to the customer) means it is never sent again.
 *
 * Runs from the `bookings:scheduled-emails` Nitro task (scheduled only by an
 * app's Cloudflare production build) and from the admin-only manual-run route.
 * There is no request event here, so config and the DB come from the startup
 * runtime config / module-level binding.
 */
import { sql } from 'drizzle-orm'
import { requiredLocale } from '@fyit/crouton-catalog/required-locale'
import { dayRange, type DayRange } from './booking-capacity'
import {
  isBookingEmailEnabled,
  resolveTranslatedField,
  resolveSlotLabels,
  type BookingEmailTriggerType
} from './booking-emails'
import {
  sendBookingEmails,
  chunkArray,
  D1_PARAM_CHUNK_SIZE,
  type BookingEmailContext
} from './email-service'

export interface ScheduledEmailsOptions {
  /** The moment of the run (default: now) */
  now?: Date
  /** Only this team's templates and bookings (default: every team) */
  teamId?: string
  /** Time zone that decides a booking's day (croutonBookings.timezone) */
  tz: string
}

export interface ScheduledEmailsResult {
  sent: number
  skipped: number
  failed: number
}

type Outcome = keyof ScheduledEmailsResult
type Db = ReturnType<typeof useDB>
interface TeamInfo { name: string, metadata: Record<string, string> }

const SCHEDULED_TRIGGERS: BookingEmailTriggerType[] = ['reminder_before', 'follow_up_after']

function parseJson<T>(value: unknown): T | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  }
  catch {
    return null
  }
}

/** Today's local date in `tz`, shifted by `days`, as YYYY-MM-DD */
export function localDayPlus(now: Date, tz: string, days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

interface DueTemplate {
  id: string
  teamId: string
  triggerType: BookingEmailTriggerType
  daysOffset: number | null
  locationId: string | null
}

interface DueBookingRow {
  id: string
  teamId: string
  owner: string
  location: string
  date: number
  slot: unknown
  status: string
  locId: string | null
  locTitle: string | null
  locStreet: string | null
  locCity: string | null
  locContent: string | null
  locTranslations: unknown
  locSlots: unknown
  ownerName: string | null
  ownerEmail: string | null
}

/** The local day a template is due for: same offset rule as the booking email status screen */
function targetRange(template: DueTemplate, now: Date, tz: string): DayRange | null {
  const offset = Math.abs(template.daysOffset || 1)
  const days = template.triggerType === 'reminder_before' ? offset : -offset
  return dayRange(localDayPlus(now, tz, days), tz)
}

async function loadTemplates(db: Db, teamId?: string): Promise<DueTemplate[]> {
  return await db.all(sql`
    SELECT id, teamId, triggerType, daysOffset, locationId
    FROM bookings_emailtemplates
    WHERE isActive = 1
      AND triggerType IN (${sql.join(SCHEDULED_TRIGGERS.map(t => sql`${t}`), sql`, `)})
      ${teamId ? sql`AND teamId = ${teamId}` : sql``}
  `) as DueTemplate[]
}

async function loadBookings(db: Db, template: DueTemplate, range: DayRange): Promise<DueBookingRow[]> {
  return await db.all(sql`
    SELECT b.id, b.teamId, b.owner, b.location, b.date, b.slot, b.status,
           l.id AS locId, l.title AS locTitle, l.street AS locStreet, l.city AS locCity,
           l.content AS locContent, l.translations AS locTranslations, l.slots AS locSlots,
           u.name AS ownerName, u.email AS ownerEmail
    FROM bookings_bookings b
    LEFT JOIN bookings_locations l ON l.id = b.location
    LEFT JOIN "user" u ON u.id = b.owner
    WHERE b.teamId = ${template.teamId}
      AND b.date >= ${range.dayStartTs} AND b.date < ${range.dayEndTs}
      AND b.status <> 'cancelled'
      ${template.locationId ? sql`AND b.location = ${template.locationId}` : sql``}
  `) as DueBookingRow[]
}

/** Already sent = a log row for this booking + template to this recipient, as `bookingId|email` */
async function loadAlreadySent(db: Db, templateId: string, bookingIds: string[]): Promise<Set<string>> {
  const sent = new Set<string>()
  for (const chunk of chunkArray(bookingIds, D1_PARAM_CHUNK_SIZE)) {
    const rows = await db.all(sql`
      SELECT bookingId, recipientEmail FROM bookings_emaillogs
      WHERE templateId = ${templateId}
        AND bookingId IN (${sql.join(chunk.map(id => sql`${id}`), sql`, `)})
    `) as Array<{ bookingId: string, recipientEmail: string }>
    for (const r of rows) sent.add(`${r.bookingId}|${r.recipientEmail}`)
  }
  return sent
}

function teamLoader(db: Db) {
  const cache = new Map<string, TeamInfo>()
  return async (id: string): Promise<TeamInfo> => {
    const hit = cache.get(id)
    if (hit) return hit
    const rows = await db.all(sql`SELECT name, metadata FROM organization WHERE id = ${id} LIMIT 1`) as Array<{ name: string, metadata: unknown }>
    const info = { name: rows[0]?.name ?? '', metadata: parseJson<Record<string, string>>(rows[0]?.metadata) ?? {} }
    cache.set(id, info)
    return info
  }
}

function locationData(b: DueBookingRow, locale: string): BookingEmailContext['locationData'] {
  if (!b.locId) return null
  const tr = parseJson<Record<string, Record<string, string>>>(b.locTranslations)
  const field = (value: string | null, name: string) => resolveTranslatedField(value, tr, name, locale, locale)
  const title = field(b.locTitle, 'title') || 'Location'
  return { id: b.locId, name: title, title, street: field(b.locStreet, 'street'), city: field(b.locCity, 'city'), content: field(b.locContent, 'content') }
}

function bookingContext(b: DueBookingRow, team: TeamInfo, locale: string): BookingEmailContext {
  const slot = parseJson<string[]>(b.slot)
  const meta = team.metadata
  return {
    id: b.id,
    teamId: b.teamId,
    owner: b.owner,
    location: b.location,
    date: new Date(Number(b.date) * 1000),
    slot,
    slotLabel: resolveSlotLabels(slot, parseJson(b.locSlots), locale),
    status: b.status,
    locationData: locationData(b, locale),
    // The booking's customer — not whoever triggered the run
    ownerUser: { id: b.owner, name: b.ownerName || 'Customer', email: b.ownerEmail ?? '' },
    teamName: team.name,
    teamEmail: meta.email || meta.contactEmail || '',
    teamPhone: meta.phone || meta.contactPhone || ''
  }
}

async function sendOne(b: DueBookingRow & { ownerEmail: string }, template: DueTemplate, team: TeamInfo, locale: string): Promise<Outcome> {
  const res = await sendBookingEmails({
    booking: bookingContext(b, team, locale),
    triggerType: template.triggerType,
    teamId: template.teamId,
    userId: b.owner,
    recipientEmail: b.ownerEmail,
    templateIds: [template.id]
  })
  if (res.customerResult?.success) return 'sent'
  return res.success && !res.customerResult ? 'skipped' : 'failed'
}

/** The app's default language — the one every template is required to have (#4244) */
function appDefaultLocale(): string {
  const i18nCfg = (useRuntimeConfig() as any)?.croutonI18n ?? {}
  return requiredLocale(i18nCfg.supportedLocales ?? [], i18nCfg.defaultLocale)
}

interface RunContext { db: Db, now: Date, tz: string, locale: string, teamInfo: (id: string) => Promise<TeamInfo>, result: ScheduledEmailsResult }

/** Send one template to every booking it is due for that has not had it yet */
async function runTemplate(template: DueTemplate, ctx: RunContext): Promise<void> {
  const range = targetRange(template, ctx.now, ctx.tz)
  const bookings = range ? await loadBookings(ctx.db, template, range) : []
  if (bookings.length === 0) return
  const alreadySent = await loadAlreadySent(ctx.db, template.id, bookings.map(b => b.id))

  for (const b of bookings) {
    const email = b.ownerEmail
    if (!email || alreadySent.has(`${b.id}|${email}`)) {
      ctx.result.skipped++
      continue
    }
    try {
      ctx.result[await sendOne({ ...b, ownerEmail: email }, template, await ctx.teamInfo(template.teamId), ctx.locale)]++
    }
    catch (error) {
      ctx.result.failed++
      console.error(`[booking-email:scheduled] booking ${b.id}, template ${template.id}:`, error)
    }
  }
}

export async function runScheduledBookingEmails(options: ScheduledEmailsOptions): Promise<ScheduledEmailsResult> {
  const result: ScheduledEmailsResult = { sent: 0, skipped: 0, failed: 0 }
  if (!isBookingEmailEnabled()) return result

  const db = useDB()
  const ctx: RunContext = { db, now: options.now ?? new Date(), tz: options.tz, locale: appDefaultLocale(), teamInfo: teamLoader(db), result }
  for (const template of await loadTemplates(db, options.teamId)) {
    await runTemplate(template, ctx)
  }
  return result
}
