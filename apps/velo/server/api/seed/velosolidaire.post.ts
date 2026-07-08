/**
 * Seed script for Velo Solidaire team (additive)
 *
 * Seeds the database with data from seedData/velosolidaire/.
 * Does NOT wipe existing data — creates a new org alongside existing ones.
 * Handles user deduplication: existing users (by email) are reused, not overwritten.
 *
 * Trigger via POST /api/seed/velosolidaire
 *
 * Order:
 * 1. Organization
 * 2. Users + Members (with deduplication)
 * 3. Locations (with translations)
 * 4. Booking Settings (no groups — this isn't a school)
 * 5. Email Templates (with translations)
 * 6. Bookings
 * 7. Email Logs
 * 8. Pages
 */
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { hashPassword } from 'better-auth/crypto'
import { organization, member, user, account } from '~~/server/db/schema'
import { bookingsLocations } from '~~/layers/bookings/collections/locations/server/database/schema'
import { bookingsSettings } from '~~/layers/bookings/collections/settings/server/database/schema'
import { bookingsEmailtemplates } from '~~/layers/bookings/collections/emailtemplates/server/database/schema'
import { bookingsBookings } from '~~/layers/bookings/collections/bookings/server/database/schema'
import { bookingsEmaillogs } from '~~/layers/bookings/collections/emaillogs/server/database/schema'
import { pagesPages } from '~~/layers/pages/collections/pages/server/database/schema'
import { parseCSVLine, parseFrontmatter, parseDate, parseDateTime, convertEmailBody } from '~~/server/utils/seed-parsers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a CSV string, handling quoted fields that may contain commas */
function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n')
  const headers = parseCSVLine(lines[0]!)
  return lines.slice(1)
    .map((line) => {
      const values = parseCSVLine(line)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => {
        row[h.trim()] = (values[i] ?? '').trim()
      })
      return row
    })
    .filter(row => row.email && row.email.trim() !== '') // filter empty rows
}

/** Convert bike inventory markdown to TipTap-compatible HTML */
function markdownToHtml(md: string): string {
  if (!md || !md.trim()) return ''

  // Split into paragraphs by double newline
  const blocks = md.split(/\n\n+/).filter(b => b.trim())
  let html = ''

  for (const block of blocks) {
    const trimmed = block.trim()

    // Heading (### ...)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      html += `<h${level}>${headingMatch[2]!.trim()}</h${level}>`
      continue
    }

    // List items
    if (trimmed.includes('\n') && trimmed.split('\n').some(l => l.trim().startsWith('*') || l.trim().startsWith('-'))) {
      const lines = trimmed.split('\n').filter(l => l.trim())
      html += '<ul>'
      for (const line of lines) {
        const text = line.trim().replace(/^[\*\-]\s*/, '').replace(/\*\*/g, '').trim()
        if (text) html += `<li><p>${text}</p></li>`
      }
      html += '</ul>'
      continue
    }

    // Regular paragraph — handle bold (**text**) and line breaks (\)
    let text = trimmed
      .split('\n')
      .map(l => l.replace(/\\$/, '').trim())
      .join('<br/>')
    // Convert **bold** to <strong>
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Convert [text](url) to <a>
    text = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    html += `<p>${text}</p>`
  }

  return html
}

/** Read a file from the seedData/velosolidaire directory */
function readSeedFile(relativePath: string): string {
  const candidates = [
    resolve(process.cwd(), 'seedData/velosolidaire', relativePath),
    resolve(process.cwd(), 'apps/velo/seedData/velosolidaire', relativePath)
  ]
  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8')
    }
  }
  throw new Error(`Seed file not found: ${relativePath}. Tried: ${candidates.join(', ')}`)
}

/** Build content as TipTap editor-compatible JSON */
function textToTipTapDoc(content: string): string {
  if (!content || !content.trim()) {
    return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })
  }
  const paragraphs = content.split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(text => ({
      type: 'paragraph',
      content: [{ type: 'text', text }]
    }))
  return JSON.stringify({
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }]
  })
}

// ---------------------------------------------------------------------------
// Seed data configuration
// ---------------------------------------------------------------------------

const locationConfigs = [
  { slug: 'abattoirs', frFile: 'content/locations/abattoirs.fr.md', nlFile: 'content/locations/abattoirs.nl.md' },
  { slug: 'marolles', frFile: 'content/locations/marolles.fr.md', nlFile: 'content/locations/marolles.nl.md' },
  { slug: 'evere', frFile: 'content/locations/evere.fr.md', nlFile: 'content/locations/evere.nl.md' }
]

const templateTypes = ['confirmation', 'reminder', 'retour'] as const

const triggerTypeMap: Record<string, string> = {
  confirmation: 'booking_created',
  reminder: 'reminder_before',
  retour: 'follow_up_after'
}

const typeNameMap: Record<string, string> = {
  confirmation: 'Booking Confirmation',
  reminder: 'Booking Reminder',
  retour: 'Follow-up'
}

const emailLogKinds = [
  { type: 'confirmation', sendField: 'confirmationSend', dateField: 'confirmationDate', triggerType: 'booking_created' },
  { type: 'reminder', sendField: 'reminderSend', dateField: 'reminderDate', triggerType: 'reminder_before' },
  { type: 'retour', sendField: 'retourMailSend', dateField: 'retourMailDate', triggerType: 'follow_up_after' }
] as const

const pageConfigs = [
  { slug: 'homepage', frFile: 'content/pages/homepage.fr.md', nlFile: 'content/pages/homepage.nl.md', showInNavigation: true },
  { slug: 'a-propos', frFile: 'content/pages/a-propos.fr.md', nlFile: 'content/pages/a-propos.nl.md', showInNavigation: true },
  { slug: 'nos-parcours-et-services', frFile: 'content/pages/nos-parcours-et-services.fr.md', nlFile: 'content/pages/nos-parcours-et-services.nl.md', showInNavigation: true },
  { slug: 'nos-services-a-la-carte', frFile: 'content/pages/nos-services-à-la-carte.fr.md', nlFile: 'content/pages/nos-services-à-la-carte.nl.md', showInNavigation: true },
  { slug: 'bookings', frFile: 'content/pages/bookings.fr.md', nlFile: 'content/pages/bookings.nl.md', showInNavigation: true },
  { slug: 'contact', frFile: 'content/pages/contact.fr.md', nlFile: 'content/pages/contact.nl.md', showInNavigation: true },
  { slug: 'register', frFile: 'content/pages/register.fr.md', nlFile: 'content/pages/register.nl.md', showInNavigation: false },
]

// ---------------------------------------------------------------------------
// Seed phases
// ---------------------------------------------------------------------------

interface SeedContext {
  db: any
  log: string[]
  now: Date
  orgId: string
  adminUserId: string
}

type LocationSlotIds = { morning: string; afternoon: string; fullday: string }

// 1. Create Organization
async function createOrganization(db: any, log: string[], now: Date): Promise<{ orgId: string; orgSlug: string }> {
  const orgId = nanoid()
  const orgSlug = 'velo-solidaire'

  // Check if org already exists
  const existingOrg = await (db as any).select().from(organization).where(eq(organization.slug as any, orgSlug)).limit(1)
  if (existingOrg.length > 0) {
    throw createError({ status: 409, statusText: 'Organization velo-solidaire already exists. Clear it first or use a different slug.' })
  }

  await (db as any).insert(organization).values({
    id: orgId,
    name: 'Vélo Solidaire',
    slug: orgSlug,
    personal: false,
    isDefault: false,
    createdAt: now
  })
  log.push(`Created organization: Vélo Solidaire (${orgId})`)

  return { orgId, orgSlug }
}

/** Reuse an existing user (by email) or create user + credential account */
async function findOrCreateUser(db: any, now: Date, email: string, associationName: string): Promise<{ userId: string; created: boolean }> {
  // Check if user already exists in DB
  const existingUser = await (db as any).select().from(user).where(eq(user.email as any, email)).limit(1)

  if (existingUser.length > 0) {
    // Reuse existing user — do NOT overwrite
    return { userId: existingUser[0].id, created: false }
  }

  // Create new user
  const userId = nanoid()
  await (db as any).insert(user).values({
    id: userId,
    name: associationName,
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    superAdmin: false,
    banned: false
  })

  // Create a credential account (no password for regular users)
  await (db as any).insert(account).values({
    id: nanoid(),
    userId,
    accountId: userId,
    providerId: 'credential',
    password: undefined,
    createdAt: now,
    updatedAt: now
  })

  return { userId, created: true }
}

/** Add the user as an org member unless they already are one */
async function ensureOrgMembership(db: any, now: Date, userId: string, orgId: string, role: string): Promise<boolean> {
  const existingMember = await (db as any).select().from(member)
    .where(eq(member.userId as any, userId))
    .limit(100)
  const alreadyMember = existingMember.some((m: any) => m.organizationId === orgId)
  if (alreadyMember) return false

  const memberRole = role === 'admin' ? 'admin' : 'member'
  await (db as any).insert(member).values({
    id: nanoid(),
    userId,
    organizationId: orgId,
    role: memberRole,
    createdAt: now
  })
  return true
}

// 2. Create Users + Members (with deduplication)
//    IMPORTANT: Only users with bookings + admin get org membership.
//    D1/SQLite has a 99 variable limit; Better Auth's findFullOrganization
//    does WHERE user.id IN (...all members), so we must keep member count < 99.
async function seedUsersAndMembers(db: any, log: string[], now: Date, orgId: string): Promise<{ userEmailToId: Record<string, string>; adminUserId: string }> {
  // First, collect emails that appear in reservations (these need org membership)
  const reservationsCSVForEmails = readSeedFile('reservations.csv')
  const reservationsForEmails = parseCSV(reservationsCSVForEmails)
  const bookingEmails = new Set<string>()
  for (const row of reservationsForEmails) {
    const email = row.email?.toLowerCase().trim()
    if (email) bookingEmails.add(email)
  }

  const usersCSV = readSeedFile('users.csv')
  const usersData = parseCSV(usersCSV)
  const userEmailToId: Record<string, string> = {}
  let adminUserId = ''
  let createdCount = 0
  let reusedCount = 0
  let memberCount = 0

  for (const row of usersData) {
    const email = row.email!.toLowerCase().trim()
    if (!email) continue

    const associationName = row.Association?.trim() || email.split('@')[0]!
    const role = row.role?.trim().toLowerCase() || 'user'

    const { userId, created } = await findOrCreateUser(db, now, email, associationName)
    if (created) createdCount++
    else reusedCount++

    userEmailToId[email] = userId

    // Track admin
    if (email === 'hi@maartenlauwaert.eu') {
      adminUserId = userId
    } else if (role === 'admin' && !adminUserId) {
      adminUserId = userId
    }

    // Only add org membership for: admin users + users who have bookings
    const needsMembership = role === 'admin' || email === 'hi@maartenlauwaert.eu' || bookingEmails.has(email)
    if (needsMembership && await ensureOrgMembership(db, now, userId, orgId, role)) {
      memberCount++
    }
  }

  // Fall back to first user if no admin found
  if (!adminUserId) {
    adminUserId = Object.values(userEmailToId)[0]!
  }

  log.push(`Users: ${createdCount} created, ${reusedCount} reused. ${memberCount} org members added (booking users + admins). ${Object.keys(userEmailToId).length} total user records.`)

  return { userEmailToId, adminUserId }
}

// 3. Create Locations (3 locations: abattoirs, marolles, evere)
async function seedLocations(ctx: SeedContext): Promise<{ locationIdMap: Record<string, string>; locationSlotIds: Record<string, LocationSlotIds> }> {
  const { db, log, now, orgId, adminUserId } = ctx
  const locationIdMap: Record<string, string> = {} // idInSheet -> db id
  const locationSlotIds: Record<string, LocationSlotIds> = {}

  for (let locIdx = 0; locIdx < locationConfigs.length; locIdx++) {
    const loc = locationConfigs[locIdx]!
    const frMd = readSeedFile(loc.frFile)
    const nlMd = readSeedFile(loc.nlFile)
    const frParsed = parseFrontmatter(frMd)
    const nlParsed = parseFrontmatter(nlMd)

    const locationId = nanoid()
    const idInSheet = frParsed.data.idInSheet || loc.slug
    locationIdMap[idInSheet] = locationId

    // Create slot IDs
    const morningId = nanoid()
    const afternoonId = nanoid()
    const fulldayId = nanoid()
    locationSlotIds[idInSheet] = { morning: morningId, afternoon: afternoonId, fullday: fulldayId }

    const slots = [
      { id: morningId, label: 'Matin', startTime: '09:30', endTime: '12:30' },
      { id: afternoonId, label: 'Après-midi', startTime: '12:30', endTime: '16:30' },
      { id: fulldayId, label: 'Toute la journée', startTime: '09:30', endTime: '16:30' }
    ]

    // Open Monday-Friday (1=Mon ... 5=Fri)
    const openDays = [1, 2, 3, 4, 5]

    await (db as any).insert(bookingsLocations).values({
      id: locationId,
      teamId: orgId,
      owner: adminUserId,
      order: locIdx,
      title: frParsed.data.title || loc.slug,
      color: null,
      street: frParsed.data.street || null,
      zip: frParsed.data.zip || null,
      city: frParsed.data.city || null,
      location: frParsed.data.location || null,
      content: frParsed.content ? markdownToHtml(frParsed.content) : null,
      allowedMemberIds: null,
      slots,
      openDays,
      slotSchedule: {},
      blockedDates: null,
      inventoryMode: false,
      quantity: 0,
      maxBookingsPerMonth: 0,
      translations: {
        en: {
          title: frParsed.data.title || loc.slug,
          street: frParsed.data.street || '',
          zip: frParsed.data.zip || '',
          city: frParsed.data.city || '',
          content: frParsed.content ? markdownToHtml(frParsed.content) : ''
        },
        fr: {
          title: frParsed.data.title || loc.slug,
          street: frParsed.data.street || '',
          zip: frParsed.data.zip || '',
          city: frParsed.data.city || '',
          content: frParsed.content ? markdownToHtml(frParsed.content) : ''
        },
        nl: {
          title: nlParsed.data.title || frParsed.data.title,
          street: nlParsed.data.street || frParsed.data.street,
          zip: nlParsed.data.zip || frParsed.data.zip,
          city: nlParsed.data.city || frParsed.data.city,
          content: nlParsed.content ? markdownToHtml(nlParsed.content) : (frParsed.content ? markdownToHtml(frParsed.content) : '')
        }
      },
      createdAt: now,
      updatedAt: now,
      createdBy: adminUserId,
      updatedBy: adminUserId
    })

    log.push(`Created location: ${frParsed.data.title} (${locationId})`)
  }

  return { locationIdMap, locationSlotIds }
}

// 4. Create Booking Settings (no groups for Velo Solidaire)
async function seedBookingSettings(ctx: SeedContext): Promise<void> {
  const { db, log, now, orgId, adminUserId } = ctx
  const settingsId = nanoid()
  await (db as any).insert(bookingsSettings).values({
    id: settingsId,
    teamId: orgId,
    owner: adminUserId,
    order: 0,
    statuses: [
      { id: nanoid(), label: 'confirmed', color: 'green' },
      { id: nanoid(), label: 'pending', color: 'yellow' },
      { id: nanoid(), label: 'cancelled', color: 'red' }
    ],
    groups: [],
    createdAt: now,
    updatedAt: now,
    createdBy: adminUserId,
    updatedBy: adminUserId
  })

  log.push('Created booking settings (no groups)')
}

// 5. Create Email Templates (3 types x 3 locations, with translations)
async function seedEmailTemplates(ctx: SeedContext, locationIdMap: Record<string, string>): Promise<Record<string, string>> {
  const { db, log, now, orgId, adminUserId } = ctx
  const templateIdMap: Record<string, string> = {} // `${type}-${locationSlug}` -> template id

  for (const loc of locationConfigs) {
    const frMd = readSeedFile(loc.frFile)
    const nlMd = readSeedFile(loc.nlFile)
    const frParsed = parseFrontmatter(frMd)
    const nlParsed = parseFrontmatter(nlMd)
    const frMails = frParsed.data.mails || {}
    const nlMails = nlParsed.data.mails || {}
    const locationId = locationIdMap[frParsed.data.idInSheet || loc.slug]!

    for (const type of templateTypes) {
      const frMail = frMails[type] || {}
      const nlMail = nlMails[type] || {}
      const templateId = nanoid()
      templateIdMap[`${type}-${loc.slug}`] = templateId

      const triggerType = triggerTypeMap[type] || type

      let daysOffset: number | null = null
      if (type === 'confirmation') daysOffset = 0
      if (type === 'reminder') daysOffset = -2
      if (type === 'retour') daysOffset = 1

      const frBodyHtml = convertEmailBody(frMail.body || '')
      const nlBodyHtml = convertEmailBody(nlMail.body || frMail.body || '')

      const enName = `${frParsed.data.title} - ${typeNameMap[type] || type}`

      await (db as any).insert(bookingsEmailtemplates).values({
        id: templateId,
        teamId: orgId,
        owner: adminUserId,
        order: 0,
        name: `${frParsed.data.title} - ${type}`,
        subject: frMail.subject || `${type} email`,
        body: frBodyHtml,
        fromEmail: frMail.from || 'info@velosolidaire.be',
        triggerType,
        recipientType: 'customer',
        isActive: true,
        daysOffset,
        locationId,
        translations: {
          en: {
            name: enName,
            subject: frMail.subject || `${type} email`,
            body: frBodyHtml
          },
          fr: {
            name: `${frParsed.data.title} - ${type}`,
            subject: frMail.subject || `${type} email`,
            body: frBodyHtml
          },
          nl: {
            name: `${nlParsed.data.title || frParsed.data.title} - ${type}`,
            subject: nlMail.subject || frMail.subject || '',
            body: nlBodyHtml
          }
        },
        createdAt: now,
        updatedAt: now,
        createdBy: adminUserId,
        updatedBy: adminUserId
      })
    }

    log.push(`Created 3 email templates for ${frParsed.data.title}`)
  }

  return templateIdMap
}

// 6. Create Bookings (from reservations CSV)
async function seedBookings(
  ctx: SeedContext,
  userEmailToId: Record<string, string>,
  locationIdMap: Record<string, string>,
  locationSlotIds: Record<string, LocationSlotIds>
): Promise<{ reservationsData: Record<string, string>[]; bookingIdMap: Record<number, string> }> {
  const { db, log, now, orgId, adminUserId } = ctx
  const reservationsCSV = readSeedFile('reservations.csv')
  const reservationsData = parseCSV(reservationsCSV)
  const bookingIdMap: Record<number, string> = {} // CSV row index -> booking id
  let bookingCount = 0

  for (let idx = 0; idx < reservationsData.length; idx++) {
    const row = reservationsData[idx]!
    const bookingId = nanoid()
    bookingIdMap[idx] = bookingId

    const email = row.email!.toLowerCase().trim()
    if (!email) continue

    const ownerId = userEmailToId[email] || adminUserId
    const locationSlug = row.location!.trim()
    const locationId = locationIdMap[locationSlug]
    if (!locationId) {
      log.push(`WARNING: Unknown location "${locationSlug}" for booking row ${idx + 2}`)
      continue
    }

    // Map moment (0=morning, 1=afternoon, 2=full day) to slot IDs
    const moment = parseInt(row.moment!, 10)
    const slots = locationSlotIds[locationSlug]!
    let slotValue: string[]
    if (moment === 0) slotValue = [slots.morning]
    else if (moment === 1) slotValue = [slots.afternoon]
    else slotValue = [slots.morning, slots.afternoon] // full day = both slots

    // Parse dates
    const bookingDate = parseDate(row.date!)
    const createdAt = row.created ? parseDateTime(row.created) : now

    await (db as any).insert(bookingsBookings).values({
      id: bookingId,
      teamId: orgId,
      owner: ownerId,
      order: 0,
      location: locationId,
      date: bookingDate,
      slot: slotValue,
      group: null, // No groups for Velo Solidaire
      quantity: 1,
      status: 'confirmed',
      createdAt,
      updatedAt: createdAt,
      createdBy: ownerId,
      updatedBy: ownerId
    })
    bookingCount++
  }

  log.push(`Created ${bookingCount} bookings`)

  return { reservationsData, bookingIdMap }
}

async function insertEmailLog(ctx: SeedContext, entry: {
  bookingId: string
  templateId: string | undefined
  email: string
  ownerId: string
  triggerType: string
  sentDate: Date
}): Promise<void> {
  const { db, orgId, adminUserId } = ctx
  await (db as any).insert(bookingsEmaillogs).values({
    id: nanoid(),
    teamId: orgId,
    owner: entry.ownerId,
    order: 0,
    bookingId: entry.bookingId,
    templateId: entry.templateId || null,
    recipientEmail: entry.email,
    triggerType: entry.triggerType,
    status: 'sent',
    sentAt: entry.sentDate.toISOString(),
    error: null,
    createdAt: entry.sentDate,
    updatedAt: entry.sentDate,
    createdBy: adminUserId,
    updatedBy: adminUserId
  })
}

// 7. Create Email Logs from CSV send flags
async function seedEmailLogs(
  ctx: SeedContext,
  userEmailToId: Record<string, string>,
  templateIdMap: Record<string, string>,
  reservationsData: Record<string, string>[],
  bookingIdMap: Record<number, string>
): Promise<void> {
  const { log, now, adminUserId } = ctx
  let emailLogCount = 0

  for (let idx = 0; idx < reservationsData.length; idx++) {
    const row = reservationsData[idx]!
    const bookingId = bookingIdMap[idx]!
    const email = row.email!.toLowerCase().trim()
    if (!email) continue
    const ownerId = userEmailToId[email] || adminUserId
    const locationSlug = row.location!.trim()

    for (const kind of emailLogKinds) {
      if (row[kind.sendField] !== 'TRUE') continue
      const rawDate = row[kind.dateField]
      const sentDate = rawDate ? parseDate(rawDate) : now
      await insertEmailLog(ctx, {
        bookingId,
        templateId: templateIdMap[`${kind.type}-${locationSlug}`],
        email,
        ownerId,
        triggerType: kind.triggerType,
        sentDate
      })
      emailLogCount++
    }
  }

  log.push(`Created ${emailLogCount} email logs`)
}

// 8. Create Pages
async function seedPages(ctx: SeedContext): Promise<void> {
  const { db, log, now, orgId, adminUserId } = ctx

  for (let pageIdx = 0; pageIdx < pageConfigs.length; pageIdx++) {
    const pageCfg = pageConfigs[pageIdx]!
    const frMd = readSeedFile(pageCfg.frFile)
    const nlMd = readSeedFile(pageCfg.nlFile)
    const frParsed = parseFrontmatter(frMd)
    const nlParsed = parseFrontmatter(nlMd)

    const pageId = nanoid()

    const frContent = textToTipTapDoc(frParsed.content || '')
    const nlContent = textToTipTapDoc(nlParsed.content || '')

    const config: Record<string, any> = {}
    if (frParsed.data.image) {
      config.image = frParsed.data.image
    }

    await (db as any).insert(pagesPages).values({
      id: pageId,
      teamId: orgId,
      owner: adminUserId,
      parentId: null,
      path: `/${pageCfg.slug}`,
      depth: 0,
      order: pageIdx,
      title: frParsed.data.title || pageCfg.slug,
      slug: pageCfg.slug,
      pageType: 'pages:regular',
      content: frContent,
      config,
      status: 'published',
      visibility: 'public',
      publishedAt: now,
      showInNavigation: pageCfg.showInNavigation,
      layout: frParsed.data.layout || null,
      seoTitle: null,
      seoDescription: null,
      ogImage: frParsed.data.image || null,
      robots: null,
      translations: {
        en: { title: frParsed.data.title || pageCfg.slug, content: frContent },
        fr: { title: frParsed.data.title || pageCfg.slug, content: frContent },
        nl: { title: nlParsed.data.title || frParsed.data.title || pageCfg.slug, content: nlContent }
      },
      createdAt: now,
      updatedAt: now,
      createdBy: adminUserId,
      updatedBy: adminUserId
    })

    log.push(`Created page: ${frParsed.data.title} (${pageId})`)
  }
}

// ---------------------------------------------------------------------------
// Main seed handler
// ---------------------------------------------------------------------------

export default defineEventHandler(async (event) => {
  // Only allow in development
  if (!import.meta.dev) {
    throw createError({ status: 403, statusText: 'Seed endpoint is only available in development' })
  }

  const db = useDB()
  const log: string[] = []
  const now = new Date()

  try {
    const { orgId, orgSlug } = await createOrganization(db, log, now)
    const { userEmailToId, adminUserId } = await seedUsersAndMembers(db, log, now, orgId)

    const ctx: SeedContext = { db, log, now, orgId, adminUserId }
    const { locationIdMap, locationSlotIds } = await seedLocations(ctx)
    await seedBookingSettings(ctx)
    const templateIdMap = await seedEmailTemplates(ctx, locationIdMap)
    const { reservationsData, bookingIdMap } = await seedBookings(ctx, userEmailToId, locationIdMap, locationSlotIds)
    await seedEmailLogs(ctx, userEmailToId, templateIdMap, reservationsData, bookingIdMap)
    await seedPages(ctx)

    return {
      success: true,
      organizationId: orgId,
      organizationSlug: orgSlug,
      summary: log
    }
  } catch (error: any) {
    if (error.statusCode || error.status) throw error

    console.error('Seed error:', error)
    throw createError({
      status: 500,
      statusText: `Seed failed: ${error.message}\n${error.stack || ''}`
    })
  }
})
