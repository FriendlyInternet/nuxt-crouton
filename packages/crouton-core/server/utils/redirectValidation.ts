import { z } from 'zod'

export const REDIRECT_STATUS_CODES = ['301', '302', '307', '308'] as const

/** A same-site path: single leading slash, no scheme, no `//`, no backslash or control chars. */
export function isSafeRedirectPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (!/^\/(?![/\\])/.test(value)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return false
  return true
}

const pathField = z.string().refine(isSafeRedirectPath, 'Must be a same-site path starting with a single /')

const statusField = z.preprocess(
  v => (typeof v === 'number' ? String(v) : v),
  z.enum(REDIRECT_STATUS_CODES)
)

export const redirectCreateSchema = z.object({
  fromPath: pathField,
  toPath: pathField,
  statusCode: statusField.optional(),
  isActive: z.boolean().optional()
})

export const redirectUpdateSchema = redirectCreateSchema.partial()

/** Validate a redirect payload; throws a 400 on bad input and returns only known fields. */
export function validateRedirectInput(body: unknown, partial?: false): z.infer<typeof redirectCreateSchema>
export function validateRedirectInput(body: unknown, partial: true): z.infer<typeof redirectUpdateSchema>
export function validateRedirectInput(body: unknown, partial = false) {
  const result = (partial ? redirectUpdateSchema : redirectCreateSchema).safeParse(body ?? {})
  if (!result.success) {
    throw createError({
      status: 400,
      statusText: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    })
  }
  return result.data
}
