/**
 * Seed script for velo app
 *
 * Seeds the database with data from the CSV and markdown files in seedData/.
 * Trigger via POST /api/seed
 *
 * Order:
 * 1. Organization
 * 2. Users + Members
 * 3. Locations (with translations)
 * 4. Booking Settings (groups from grades)
 * 5. Email Templates (with translations)
 * 6. Bookings
 * 7. Email Logs
 * 8. Pages
 * 9. UI Translations
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
import { parseCSV, parseFrontmatter, parseDate, parseDateTime, convertEmailBody } from '~~/server/utils/seed-parsers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert the bike inventory markdown to TipTap-compatible HTML */
function bikeMarkdownToHtml(md: string): string {
  const lines = md.trim().split('\n').filter(l => l.trim() !== '')
  let html = '<ul>'
  let inSubList = false

  for (const line of lines) {
    const trimmed = line.trim()
    // Sub-item: starts with "* ######" after indentation
    const isSubItem = line.startsWith('  ') && trimmed.startsWith('* ')
    // Main item: starts with "* " at root level
    const isMainItem = !line.startsWith('  ') && trimmed.startsWith('* ')

    // Extract text: strip "* ", "######", "**" markers
    let text = trimmed
      .replace(/^\*\s*/, '')
      .replace(/^#{1,6}\s*/, '')
      .replace(/\*\*/g, '')
      .trim()

    if (isMainItem) {
      if (inSubList) {
        html += '</ul></li>'
        inSubList = false
      }
      html += `<li><p><strong>${text}</strong></p>`
      // Don't close <li> yet — sub-items may follow
      inSubList = false
    } else if (isSubItem) {
      if (!inSubList) {
        html += '<ul>'
        inSubList = true
      }
      html += `<li><p>${text}</p></li>`
    }
  }

  if (inSubList) html += '</ul>'
  html += '</li></ul>'
  return html
}

/** Read a file from the seedData directory */
function readSeedFile(relativePath: string): string {
  // Try multiple possible roots (cwd may be monorepo root or app root)
  const candidates = [
    resolve(process.cwd(), 'seedData', relativePath),
    resolve(process.cwd(), 'apps/velo/seedData', relativePath)
  ]
  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8')
    }
  }
  throw new Error(`Seed file not found: ${relativePath}. Tried: ${candidates.join(', ')}`)
}

/** Build content as TipTap editor-compatible JSON (paragraph nodes, not richTextBlock) */
function textToTipTapDoc(intro: string, body: string): string {
  const paragraphs = [intro, ...body.split(/\n\n+/)]
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
  { slug: '4saisons', frFile: 'content/locations/4saisons.fr.md', nlFile: 'content/locations/4saisons.nl.md' },
  { slug: 'peterpan', frFile: 'content/locations/peterpan.fr.md', nlFile: 'content/locations/peterpan.nl.md' }
]

// Create grade-to-group mapping with en/fr/nl translations
const gradeTranslations: Record<string, { en: string; fr: string; nl: string }> = {
  'Première primaire': { en: '1st grade primary', fr: 'Première primaire', nl: 'Eerste leerjaar' },
  'Deuxième primaire': { en: '2nd grade primary', fr: 'Deuxième primaire', nl: 'Tweede leerjaar' },
  'Troisième primaire': { en: '3rd grade primary', fr: 'Troisième primaire', nl: 'Derde leerjaar' },
  'Quatrième primaire': { en: '4th grade primary', fr: 'Quatrième primaire', nl: 'Vierde leerjaar' },
  'Cinquième primaire': { en: '5th grade primary', fr: 'Cinquième primaire', nl: 'Vijfde leerjaar' },
  'Sixième primaire': { en: '6th grade primary', fr: 'Sixième primaire', nl: 'Zesde leerjaar' },
  'Première secondaire': { en: '1st grade secondary', fr: 'Première secondaire', nl: 'Eerste middelbaar' },
  'Deuxième secondaire': { en: '2nd grade secondary', fr: 'Deuxième secondaire', nl: 'Tweede middelbaar' },
  'Troisième secondaire': { en: '3rd grade secondary', fr: 'Troisième secondaire', nl: 'Derde middelbaar' },
  'Quatrième secondaire': { en: '4th grade secondary', fr: 'Quatrième secondaire', nl: 'Vierde middelbaar' },
  'Cinquième secondaire': { en: '5th grade secondary', fr: 'Cinquième secondaire', nl: 'Vijfde middelbaar' },
  'Sixième secondaire': { en: '6th grade secondary', fr: 'Sixième secondaire', nl: 'Zesde middelbaar' },
  'Vijfde Leerjaar': { en: '5th grade primary', fr: 'Cinquième primaire', nl: 'Vijfde leerjaar' },
  'Adultes': { en: 'Adults', fr: 'Adultes', nl: 'Volwassenen' }
}

const templateTypes = ['confirmation', 'reminder', 'retour'] as const

// Map seed types to crouton-bookings trigger types
const triggerTypeMap: Record<string, string> = {
  confirmation: 'booking_created',
  reminder: 'reminder_before',
  retour: 'follow_up_after'
}

// Map type names to readable English names
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
  {
    slug: 'homepage',
    frFile: 'content/pages/homepage.fr.md',
    nlFile: 'content/pages/homepage.nl.md',
    pageType: 'pages:regular',
    showInNavigation: true
  },
  {
    slug: 'contact',
    frFile: 'content/pages/contact.fr.md',
    nlFile: 'content/pages/contact.nl.md',
    pageType: 'pages:regular',
    showInNavigation: true
  },
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
  const orgSlug = 'school-velotek'

  // Check if org already exists
  const existingOrg = await (db as any).select().from(organization).where(eq(organization.slug as any, orgSlug)).limit(1)
  if (existingOrg.length > 0) {
    throw createError({ status: 409, statusText: 'Organization school-velotek already exists. Clear the database first.' })
  }

  await (db as any).insert(organization).values({
    id: orgId,
    name: 'School Vélotek',
    slug: orgSlug,
    personal: false,
    isDefault: true,
    createdAt: now
  })
  log.push(`Created organization: School Vélotek (${orgId})`)

  return { orgId, orgSlug }
}

// 2. Create Users + Members
async function seedUsersAndMembers(db: any, log: string[], now: Date, orgId: string): Promise<{ userEmailToId: Record<string, string>; adminUserId: string }> {
  const usersCSV = readSeedFile('Velotheek Sint-Gillis - users.csv')
  const usersData = parseCSV(usersCSV)
  const userEmailToId: Record<string, string> = {}
  let adminUserId = ''

  for (const row of usersData) {
    const email = row.email!.toLowerCase().trim()
    const userId = nanoid()
    userEmailToId[email] = userId

    // Use context as the user name (school/org name)
    const name = row.context?.trim() || email.split('@')[0]!
    const role = row.role?.trim() || 'user'

    // Use your account as the primary admin/owner for all seeded data
    if (email === 'hi@maartenlauwaert.eu') {
      adminUserId = userId
    } else if (role === 'admin' && !adminUserId) {
      adminUserId = userId
    }

    await (db as any).insert(user).values({
      id: userId,
      name,
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      superAdmin: email === 'hi@maartenlauwaert.eu',
      banned: false
    })

    // Create a credential account
    // Set password for dev account, no password for others
    const devPassword = email === 'hi@maartenlauwaert.eu' ? await hashPassword('pmcppaulmcparty') : undefined
    await (db as any).insert(account).values({
      id: nanoid(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: devPassword,
      createdAt: now,
      updatedAt: now
    })

    // Link as member to org
    const memberRole = role === 'admin' ? 'admin' : 'member'
    await (db as any).insert(member).values({
      id: nanoid(),
      userId,
      organizationId: orgId,
      role: memberRole,
      createdAt: now
    })
  }

  // Fall back to first user if no admin found
  if (!adminUserId) {
    adminUserId = Object.values(userEmailToId)[0]!
  }

  log.push(`Created ${usersData.length} users and members`)

  return { userEmailToId, adminUserId }
}

// 3. Create Locations
async function seedLocations(ctx: SeedContext): Promise<{ locationIdMap: Record<string, string>; locationSlotIds: Record<string, LocationSlotIds> }> {
  const { db, log, now, orgId, adminUserId } = ctx
  const locationIdMap: Record<string, string> = {} // idInSheet -> db id
  const locationSlotIds: Record<string, LocationSlotIds> = {}

  for (const loc of locationConfigs) {
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
      { id: morningId, label: 'Matin', startTime: '08:30', endTime: '12:30' },
      { id: afternoonId, label: 'Après-midi', startTime: '13:00', endTime: '16:30' },
      { id: fulldayId, label: 'Toute la journée', startTime: '08:30', endTime: '16:30' }
    ]

    // Open Monday-Friday (1=Mon ... 5=Fri), closed Sat/Sun
    const openDays = [1, 2, 3, 4, 5]

    await (db as any).insert(bookingsLocations).values({
      id: locationId,
      teamId: orgId,
      owner: adminUserId,
      order: 0,
      title: frParsed.data.title || loc.slug,
      color: null,
      street: frParsed.data.street || null,
      zip: frParsed.data.zip || null,
      city: frParsed.data.city || null,
      location: frParsed.data.location || null,
      content: frParsed.content ? bikeMarkdownToHtml(frParsed.content) : null,
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
          content: frParsed.content ? bikeMarkdownToHtml(frParsed.content) : ''
        },
        fr: {
          title: frParsed.data.title || loc.slug,
          street: frParsed.data.street || '',
          zip: frParsed.data.zip || '',
          city: frParsed.data.city || '',
          content: frParsed.content ? bikeMarkdownToHtml(frParsed.content) : ''
        },
        nl: {
          title: nlParsed.data.title || frParsed.data.title,
          street: nlParsed.data.street || frParsed.data.street,
          zip: nlParsed.data.zip || frParsed.data.zip,
          city: nlParsed.data.city || frParsed.data.city,
          content: nlParsed.content ? bikeMarkdownToHtml(nlParsed.content) : (frParsed.content ? bikeMarkdownToHtml(frParsed.content) : '')
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

// 4. Create Booking Settings (groups from grades)
async function seedBookingSettings(ctx: SeedContext): Promise<{ reservationsData: Record<string, string>[]; groupIdMap: Record<string, string> }> {
  const { db, log, now, orgId, adminUserId } = ctx
  const reservationsCSV = readSeedFile('Velotheek Sint-Gillis - reservations.csv')
  const reservationsData = parseCSV(reservationsCSV)

  // Extract unique grades
  const uniqueGrades = [...new Set(reservationsData.map(r => r.grade!.trim()))]

  const groupIdMap: Record<string, string> = {} // grade string -> group id
  const groups = uniqueGrades.map((grade) => {
    const id = nanoid()
    groupIdMap[grade] = id
    const trans = gradeTranslations[grade]
    return {
      id,
      label: trans?.en || grade,
      translations: {
        en: trans?.en || grade,
        fr: trans?.fr || grade,
        nl: trans?.nl || grade
      }
    }
  })

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
    groups,
    createdAt: now,
    updatedAt: now,
    createdBy: adminUserId,
    updatedBy: adminUserId
  })

  log.push(`Created booking settings with ${groups.length} groups: ${uniqueGrades.join(', ')}`)

  return { reservationsData, groupIdMap }
}

// 5. Create Email Templates (3 types x 2 locations, with translations)
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

      // Determine days offset
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
        fromEmail: frMail.from || 'info@schoolvelotek.be',
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
  locationSlotIds: Record<string, LocationSlotIds>,
  groupIdMap: Record<string, string>,
  reservationsData: Record<string, string>[]
): Promise<Record<number, string>> {
  const { db, log, now, orgId, adminUserId } = ctx
  const bookingIdMap: Record<number, string> = {} // CSV row index -> booking id

  for (let idx = 0; idx < reservationsData.length; idx++) {
    const row = reservationsData[idx]!
    const bookingId = nanoid()
    bookingIdMap[idx] = bookingId

    const email = row.email!.toLowerCase().trim()
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

    // Map grade to group ID
    const grade = row.grade!.trim()
    const groupId = groupIdMap[grade] || null

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
      group: groupId,
      quantity: 1,
      status: 'confirmed',
      createdAt,
      updatedAt: createdAt,
      createdBy: ownerId,
      updatedBy: ownerId
    })
  }

  log.push(`Created ${reservationsData.length} bookings`)

  return bookingIdMap
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

// 8. Create Pages (homepage, contact) — fr content as default
async function seedPages(ctx: SeedContext): Promise<void> {
  const { db, log, now, orgId, adminUserId } = ctx

  for (const pageCfg of pageConfigs) {
    const frMd = readSeedFile(pageCfg.frFile)
    const nlMd = readSeedFile(pageCfg.nlFile)
    const frParsed = parseFrontmatter(frMd)
    const nlParsed = parseFrontmatter(nlMd)

    const pageId = nanoid()

    const frBlockContent = textToTipTapDoc(frParsed.data.intro || '', frParsed.content || '')
    const nlBlockContent = textToTipTapDoc(nlParsed.data.intro || '', nlParsed.content || '')

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
      order: pageCfg.slug === 'homepage' ? 0 : 1,
      title: frParsed.data.title || pageCfg.slug,
      slug: pageCfg.slug,
      pageType: pageCfg.pageType,
      content: frBlockContent,
      config,
      status: 'published',
      visibility: 'public',
      publishedAt: now,
      showInNavigation: pageCfg.showInNavigation,
      layout: null,
      seoTitle: null,
      seoDescription: null,
      ogImage: frParsed.data.image || null,
      robots: null,
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
    const { reservationsData, groupIdMap } = await seedBookingSettings(ctx)
    const templateIdMap = await seedEmailTemplates(ctx, locationIdMap)
    const bookingIdMap = await seedBookings(ctx, userEmailToId, locationIdMap, locationSlotIds, groupIdMap, reservationsData)
    await seedEmailLogs(ctx, userEmailToId, templateIdMap, reservationsData, bookingIdMap)
    await seedPages(ctx)

    return {
      success: true,
      organizationId: orgId,
      organizationSlug: orgSlug,
      summary: log
    }
  } catch (error: any) {
    // Re-throw createError instances (like 409)
    if (error.statusCode || error.status) throw error

    console.error('Seed error:', error)
    throw createError({
      status: 500,
      statusText: `Seed failed: ${error.message}\n${error.stack || ''}`
    })
  }
})
