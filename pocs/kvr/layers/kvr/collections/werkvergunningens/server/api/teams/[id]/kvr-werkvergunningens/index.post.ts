// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createKvrWerkvergunningen, updateKvrWerkvergunningen } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'
import {
  kvrWerkvergunningensCableItemSchema,
  kvrWerkvergunningensPhotoItemSchema
} from '../../../../../app/composables/useKvrWerkvergunningens'

const bodySchema = z.object({
  sblNumber: z.string().min(1, 'sblNumber is required'),
  datum: z.coerce.date({ message: 'datum is required' }),
  workType: z.string().min(1, 'workType is required'),
  cables: z.array(kvrWerkvergunningensCableItemSchema).optional(),
  straat: z.string().min(1, 'straat is required'),
  huisnummer: z.string().min(1, 'huisnummer is required'),
  postcode: z.string().min(1, 'postcode is required'),
  gemeente: z.string().min(1, 'gemeente is required'),
  lng: z.number().nullable().optional(),
  lat: z.number().nullable().optional(),
  ploegLeden: z.string().optional(),
  plaats: z.string().optional(),
  opgemaaktOp: z.coerce.date().nullable().optional(),
  werkverantwoordelijkeNaam: z.string().optional(),
  werkverantwoordelijkeVoornaam: z.string().optional(),
  werkverantwoordelijkeHoedanigheid: z.string().optional(),
  werkverantwoordelijkeAannemer: z.string().optional(),
  werkverantwoordelijkeHandtekening: z.string().nullable().optional(),
  schakelbevoegdeNaam: z.string().optional(),
  schakelbevoegdeVoornaam: z.string().optional(),
  schakelbevoegdeHandtekening: z.string().nullable().optional(),
  photos: z.array(kvrWerkvergunningensPhotoItemSchema).optional(),
  recipientEmail: z.string().min(1, 'recipientEmail is required'),
  emailStatus: z.string().optional(),
  formPdfPath: z.string().nullable().optional()
}).strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // Exclude id field to let the database generate it
  const dataWithoutId = { ...body }

  // Convert date string to Date object
  if (dataWithoutId.datum) {
    dataWithoutId.datum = new Date(dataWithoutId.datum)
  }
  // Convert date string to Date object
  if (dataWithoutId.opgemaaktOp) {
    dataWithoutId.opgemaaktOp = new Date(dataWithoutId.opgemaaktOp)
  }
  const dbTimer = timing.start('db')
  const result = await createKvrWerkvergunningen({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id,
    emailStatus: 'pending'
  })
  dbTimer.end()

  // Fire-and-forget email send; update emailStatus when done.
  // We await it so the client gets an accurate status in the response.
  const emailTimer = timing.start('email')
  const emailResult = await sendWerkvergunningEmail(result as any, event)
  emailTimer.end()

  try {
    await updateKvrWerkvergunningen(
      result.id,
      team.id,
      user.id,
      { emailStatus: emailResult.status },
      { role: 'owner' }
    )
  }
  catch (err) {
    console.error('[kvr] Failed to update emailStatus:', err)
  }

  return { ...result, emailStatus: emailResult.status, emailError: emailResult.error }
})