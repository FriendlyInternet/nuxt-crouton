/**
 * Batch create bookings endpoint - creates multiple bookings in a single transaction
 *
 * Used for cart checkout - creates all items in the cart as bookings
 *
 * Request body:
 * {
 *   bookings: CartItem[]
 * }
 *
 * Response:
 * {
 *   success: true,
 *   count: number,
 *   bookings: Booking[],
 *   emailsSent?: number
 * }
 */
import { eq, and, gte, lte, sum } from 'drizzle-orm'
import { useNitroApp } from 'nitropack/runtime'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { toMonthKey, monthBounds } from '@fyit/crouton-core/shared/utils/date'
import { FULL_DAY_ID, fullDayConflict } from '../../../../../app/utils/full-day'
import { bookingsBookings } from '~~/layers/bookings/collections/bookings/server/database/schema'
import { bookingsLocations } from '~~/layers/bookings/collections/locations/server/database/schema'
import { isBookingEmailEnabled, resolveTranslatedField, resolveSlotLabels } from '../../../../utils/booking-emails'
import {
  triggerBookingCreatedEmail,
  type BookingEmailContext
} from '../../../../utils/email-service'

interface CartItem {
  id: string
  locationId: string
  locationTitle: string
  date: string
  slotIds?: string[]
  slotLabels?: string[]
  groupId?: string | null
  groupLabel?: string | null
  quantity?: number // For inventory mode
  isInventoryMode?: boolean
}

interface BatchRequestBody {
  bookings: CartItem[]
  locale?: string
}

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<BatchRequestBody>(event)

  const locale = body.locale || 'en'

  if (!body.bookings || !Array.isArray(body.bookings) || body.bookings.length === 0) {
    throw createError({
      status: 400,
      statusText: 'No bookings provided',
    })
  }

  // Limit batch size to prevent abuse
  if (body.bookings.length > 20) {
    throw createError({
      status: 400,
      statusText: 'Maximum 20 bookings per batch',
    })
  }

  // --- Monthly booking limit enforcement ---
  // Collect unique (locationId, month) pairs from the cart items
  const locationMonthPairs = new Map<string, Set<string>>()
  for (const item of body.bookings) {
    const itemDate = new Date(item.date)
    const monthKey = toMonthKey(itemDate)
    if (!locationMonthPairs.has(item.locationId)) {
      locationMonthPairs.set(item.locationId, new Set())
    }
    locationMonthPairs.get(item.locationId)!.add(monthKey)
  }

  const db = useDB()

  // Fetch all locations for this team (used for limit checking + email context)
  const locationIds = [...locationMonthPairs.keys()]
  const allLocations = locationIds.length > 0
    ? await db
        .select({
          id: bookingsLocations.id,
          title: bookingsLocations.title,
          street: bookingsLocations.street,
          city: bookingsLocations.city,
          content: bookingsLocations.content,
          translations: bookingsLocations.translations,
          slots: bookingsLocations.slots,
          maxBookingsPerMonth: bookingsLocations.maxBookingsPerMonth,
        })
        .from(bookingsLocations)
        .where(
          and(
            eq(bookingsLocations.teamId as any, team.id),
          ),
        )
    : []
  const dbLocationMap = new Map(allLocations.map((l: any) => [l.id, l]))

  // Check limits for each location
  if (locationIds.length > 0) {
    const locationMap = dbLocationMap

    for (const [locationId, months] of locationMonthPairs) {
      const location = locationMap.get(locationId)
      if (!(location as any)?.maxBookingsPerMonth) continue

      const limit = (location as any).maxBookingsPerMonth

      for (const monthKey of months) {
        const { monthStart, monthEnd } = monthBounds(monthKey)

        // Sum existing active booking quantities for this user/location/month
        const existingResult = await db
          .select({ total: sum(bookingsBookings.quantity as any) })
          .from(bookingsBookings)
          .where(
            and(
              eq(bookingsBookings.location as any, locationId),
              eq(bookingsBookings.createdBy as any, user.id),
              eq(bookingsBookings.status as any, 'active'),
              gte(bookingsBookings.date as any, monthStart),
              lte(bookingsBookings.date as any, monthEnd),
            ),
          )

        const existingCount = Number(existingResult[0]?.total) || 0

        // Sum quantities of new items in this batch targeting the same location/month
        const newCount = body.bookings
          .filter((item) => {
            const d = new Date(item.date)
            return item.locationId === locationId && toMonthKey(d) === monthKey
          })
          .reduce((acc, item) => acc + (item.quantity ?? 1), 0)

        if (existingCount + newCount > limit) {
          const remaining = Math.max(0, limit - existingCount)
          const nitroApp = useNitroApp()
          nitroApp.hooks.callHook('crouton:operation', {
            type: 'booking:limit-reached',
            source: 'crouton-bookings',
            teamId: team.id,
            userId: user.id,
            metadata: {
              locationId,
              monthKey,
              currentCount: existingCount,
              limit,
              attempted: newCount,
              remaining,
            },
          }).catch(() => {})
          throw createError({
            status: 400,
            statusText: `Monthly booking limit reached for "${(location as any).title}". Limit: ${limit} per month, existing: ${existingCount}, trying to add: ${newCount}. You can add ${remaining} more.`,
          })
        }
      }
    }
  }

  // --- Group+slot uniqueness enforcement ---
  // When groups are used, prevent the same group from booking the same slot+date+location twice
  const groupedItems = body.bookings.filter(item => item.groupId && item.slotIds?.length && !item.slotIds.includes('inventory'))
  if (groupedItems.length > 0) {
    // Check for duplicates within the batch itself
    const batchKeys = new Set<string>()
    for (const item of groupedItems) {
      for (const slotId of item.slotIds!) {
        const key = `${item.locationId}|${item.date}|${slotId}|${item.groupId}`
        if (batchKeys.has(key)) {
          throw createError({
            status: 400,
            statusText: `Duplicate group+slot in batch: ${item.groupId} already has ${slotId} on ${item.date}`,
          })
        }
        batchKeys.add(key)
      }
    }

    // Check against existing bookings in the database
    for (const item of groupedItems) {
      const existing = await db
        .select({ slot: bookingsBookings.slot })
        .from(bookingsBookings)
        .where(
          and(
            eq(bookingsBookings.location as any, item.locationId),
            eq(bookingsBookings.status as any, 'active'),
            eq(bookingsBookings.date as any, new Date(item.date)),
            eq(bookingsBookings.group as any, item.groupId!),
          ),
        )

      // Check if any existing booking for this group has any of the same slots
      for (const row of existing) {
        let existingSlotIds: string[] = []
        if (row.slot) {
          if (typeof row.slot === 'string') {
            try { existingSlotIds = JSON.parse(row.slot) } catch { existingSlotIds = [row.slot] }
          } else if (Array.isArray(row.slot)) {
            existingSlotIds = row.slot as string[]
          }
        }
        for (const slotId of item.slotIds!) {
          if (existingSlotIds.includes(slotId)) {
            throw createError({
              status: 409,
              statusText: `This group already has a booking for this slot on this date`,
            })
          }
        }
      }
    }
  }

  // --- Full-day exclusivity (#2261) ---
  // The built-in full day can't share a location+date with any other slot —
  // whether booked already or earlier in this same batch.
  const slotItems = body.bookings.filter(item => item.slotIds?.length && !item.slotIds.includes('inventory'))
  if (slotItems.some(item => item.slotIds!.includes(FULL_DAY_ID))) {
    const takenByKey = new Map<string, string[]>()
    for (const item of slotItems) {
      const key = `${item.locationId}|${item.date}`
      if (!takenByKey.has(key)) {
        const rows = await db
          .select({ slot: bookingsBookings.slot })
          .from(bookingsBookings)
          .where(
            and(
              eq(bookingsBookings.location as any, item.locationId),
              eq(bookingsBookings.status as any, 'active'),
              eq(bookingsBookings.date as any, new Date(item.date)),
            ),
          )
        const existing: string[] = []
        for (const row of rows) {
          if (typeof row.slot === 'string') {
            try { existing.push(...JSON.parse(row.slot)) } catch { existing.push(row.slot) }
          } else if (Array.isArray(row.slot)) {
            existing.push(...(row.slot as string[]))
          }
        }
        takenByKey.set(key, existing)
      }
      const taken = takenByKey.get(key)!
      if (fullDayConflict(item.slotIds!, taken)) {
        throw createError({
          status: 409,
          statusText: 'The full day can\'t be combined with another slot on this date',
        })
      }
      taken.push(...item.slotIds!)
    }
  }

  // Transform cart items to database records (one row per cart item, quantity stored on the row)
  const now = new Date()
  const bookingsToInsert = body.bookings.map((item) => ({
    teamId: team.id,
    owner: user.id,
    order: 0,
    location: item.locationId,
    date: new Date(item.date),
    slot: item.slotIds?.length && !item.slotIds.includes('inventory') ? item.slotIds : null, // Array for JSON column
    quantity: item.isInventoryMode ? (item.quantity ?? 1) : 1,
    group: item.groupId || null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: user.id,
    updatedBy: user.id,
  }))

  try {
    // Insert all bookings in a single transaction
    const created = await db
      .insert(bookingsBookings)
      .values(bookingsToInsert as any)
      .returning()

    const nitroApp = useNitroApp()

    // Collect unique location IDs from the created bookings for the summary
    const uniqueLocationIds = [...new Set(created.map((b: any) => b.location))]

    // Emit batch-created operation event (one summary, not one per booking)
    nitroApp.hooks.callHook('crouton:operation', {
      type: 'booking:batch-created',
      source: 'crouton-bookings',
      teamId: team.id,
      userId: user.id,
      metadata: {
        count: created.length,
        locationIds: uniqueLocationIds,
        // Include single locationId for convenience when batch targets one location
        locationId: uniqueLocationIds.length === 1 ? uniqueLocationIds[0] : undefined,
      },
    }).catch(() => {})

    // Trigger booking_created emails (non-blocking)
    let emailsSent = 0
    if (isBookingEmailEnabled() && created.length > 0) {
      // Build a map of locationId -> cart item for location titles
      const locationMap = new Map(
        body.bookings.map(item => [item.locationId, item])
      )
      const teamMetadata = (team.metadata || {}) as Record<string, string>

      // Send emails in background - don't block checkout
      const emailPromises = created.map(async (booking: any) => {
        const cartItem = locationMap.get(booking.location)

        // Build booking context with DB location data — resolve translations
        const dbLocation = dbLocationMap.get(booking.location) as any
        const tr = dbLocation?.translations as Record<string, Record<string, string>> | null
        const locationTitle = resolveTranslatedField(dbLocation?.title, tr, 'title', locale) || cartItem?.locationTitle || 'Location'
        const locationStreet = resolveTranslatedField(dbLocation?.street, tr, 'street', locale)
        const locationCity = resolveTranslatedField(dbLocation?.city, tr, 'city', locale)
        const locationContent = resolveTranslatedField(dbLocation?.content, tr, 'content', locale)

        // Resolve slot IDs to human-readable labels
        const slotLabel = resolveSlotLabels(booking.slot, dbLocation?.slots as any)

        const bookingContext: BookingEmailContext = {
          id: booking.id,
          teamId: booking.teamId,
          owner: booking.owner,
          location: booking.location,
          date: booking.date,
          slot: booking.slot,
          slotLabel,
          status: booking.status,
          locationData: {
            id: booking.location,
            name: locationTitle,
            title: locationTitle,
            street: locationStreet,
            city: locationCity,
            content: locationContent
          },
          ownerUser: {
            id: user.id,
            name: user.name || 'Customer',
            email: user.email || ''
          },
          teamName: team.name,
          teamEmail: teamMetadata.email || teamMetadata.contactEmail || '',
          teamPhone: teamMetadata.phone || teamMetadata.contactPhone || ''
        }

        try {
          const result = await triggerBookingCreatedEmail(
            bookingContext,
            team.id,
            user.id,
            undefined, // adminEmail
            locale,
            event
          )
          return result.success ? 1 : 0
        }
        catch (err) {
          console.error('[batch-bookings] Email trigger failed:', err)
          return 0
        }
      })

      // Wait for all emails to be triggered (with timeout)
      try {
        const results = await Promise.race([
          Promise.all(emailPromises),
          new Promise<number[]>(resolve =>
            setTimeout(() => resolve([]), 5000) // 5s timeout
          )
        ])
        emailsSent = results.reduce((sum, n) => sum + n, 0)
      }
      catch {
        // Continue even if email sending fails
      }
    }

    return {
      success: true,
      count: created.length,
      bookings: created,
      ...(emailsSent > 0 && { emailsSent })
    }
  }
  catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Failed to create batch bookings:', msg, error)
    throw createError({
      status: 500,
      statusText: `Failed to create bookings: ${msg}`,
    })
  }
})
