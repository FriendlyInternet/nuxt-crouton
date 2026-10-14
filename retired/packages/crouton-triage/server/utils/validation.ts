/**
 * Input Validation Schemas
 *
 * Provides:
 * - Zod schemas for validating API inputs
 * - Type-safe validation with error messages
 * - Reusable validation helpers
 *
 * Security benefits:
 * - Prevents injection attacks through strict type validation
 * - Enforces data constraints (length, format, etc.)
 * - Provides clear error messages for debugging
 */

import { z } from 'zod'

/**
 * Common validation patterns
 */

// Email validation
export const emailSchema = z.string().email('Invalid email address')

// URL validation
export const urlSchema = z.string().url('Invalid URL')

// Team ID validation (slug format)
export const teamIdSchema = z.string()
  .min(1, 'Team ID is required')
  .max(100, 'Team ID too long')
  .regex(/^[a-z0-9-]+$/, 'Team ID must contain only lowercase letters, numbers, and hyphens')

// Source type validation
export const sourceTypeSchema = z.enum(['figma', 'slack'], {
  error: () => ({ message: 'Source type must be "figma" or "slack"' }),
})

/**
 * Discussion retry request validation
 */
export const retryRequestSchema = z.object({
  skipAI: z.boolean().optional().default(false),
  skipNotion: z.boolean().optional().default(false),
})

/**
 * User mapping validation
 */
export const userMappingSchema = z.object({
  sourceType: sourceTypeSchema,
  sourceUserId: z.string().min(1, 'Source user ID is required'),
  sourceUserEmail: z.string().email().optional(),
  sourceUserName: z.string().optional(),
  notionUserId: z.string().min(1, 'Notion user ID is required'),
  notionUserName: z.string().optional(),
  notionUserEmail: z.string().email().optional(),
  mappingType: z.enum(['manual', 'auto-email', 'auto-name', 'imported']).default('manual'),
  confidence: z.number().min(0).max(1).default(1),
  isActive: z.boolean().default(true),
  teamId: teamIdSchema,
})

/**
 * Bulk user mapping import validation
 */
export const bulkUserMappingSchema = z.array(userMappingSchema).max(1000, 'Maximum 1000 mappings per import')

/**
 * Helper function to validate and parse request body with Zod schema
 *
 * @param event - H3 event object
 * @param schema - Zod schema to validate against
 * @returns Parsed and validated data
 *
 * @example
 * ```ts
 * const data = await validateRequestBody(event, sourceConfigSchema)
 * // data is now type-safe and validated
 * ```
 */
export async function validateRequestBody<T extends z.ZodType>(
  event: any,
  schema: T,
): Promise<z.infer<T>> {
  try {
    const body = await readBody(event)
    return schema.parse(body)
  }
  catch (error) {
    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Validation Error',
        data: {
          errors: error.issues.map((err: any) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        },
      })
    }
    throw error
  }
}

/**
 * Helper function to validate query parameters
 *
 * @param event - H3 event object
 * @param schema - Zod schema to validate against
 * @returns Parsed and validated data
 *
 * @example
 * ```ts
 * const query = validateQuery(event, z.object({
 *   teamId: teamIdSchema,
 *   limit: z.coerce.number().min(1).max(100).default(10)
 * }))
 * ```
 */
export function validateQuery<T extends z.ZodType>(
  event: any,
  schema: T,
): z.infer<T> {
  try {
    const query = getQuery(event)
    return schema.parse(query)
  }
  catch (error) {
    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Validation Error',
        data: {
          errors: error.issues.map((err: any) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        },
      })
    }
    throw error
  }
}

