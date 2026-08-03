/**
 * Shared API-key auth check for /api/print-server/* endpoints.
 *
 * Validates the `x-api-key` header against runtimeConfig.croutonPrinting.printApiKey
 * (override via env NUXT_CROUTON_PRINTING_PRINT_API_KEY). The legacy
 * croutonSales.printApiKey / NUXT_CROUTON_SALES_PRINT_API_KEY is still honoured
 * during migration. Default key is '1234' (matches the dev default in the RUT956
 * polling spooler script).
 */
import type { H3Event } from 'h3'
import { getDeviceCredentials, resolveDeviceAuth } from './spooler-device'

function resolvePrintApiKey(config: ReturnType<typeof useRuntimeConfig>): string {
  return (config.croutonPrinting as { printApiKey?: string } | undefined)?.printApiKey
    || (config.croutonSales as { printApiKey?: string } | undefined)?.printApiKey
    || '1234'
}

export function requirePrintServerKey(event: H3Event): void {
  const expected = resolvePrintApiKey(useRuntimeConfig(event))
  if (getHeader(event, 'x-api-key') !== expected) {
    throw createError({ status: 401, statusText: 'Invalid API key' })
  }
}

/** A claimed device can only report on jobs of the team that claimed it. */
function assertJobBelongsToDevice(jobTeamId: string | null, deviceTeamId: string): void {
  if (jobTeamId && jobTeamId !== deviceTeamId) {
    throw createError({ status: 404, statusText: 'Print job not found' })
  }
}

/**
 * Auth for the job callbacks (`complete`/`fail`), both spooler generations:
 * a paired device (#1366) presents `x-device-id`/`x-device-code` and may only
 * touch its OWN team's jobs; the legacy script keeps the shared `x-api-key`
 * (team-unscoped — it predates teams on the job row).
 */
export async function requireSpoolerCallbackAuth(event: H3Event, jobTeamId: string | null): Promise<void> {
  const creds = getDeviceCredentials(event)
  if (!creds) {
    requirePrintServerKey(event)
    return
  }
  const auth = await resolveDeviceAuth(creds)
  if (auth?.status !== 'claimed') {
    throw createError({ status: 401, statusText: 'Invalid device credentials' })
  }
  assertJobBelongsToDevice(jobTeamId, auth.teamId)
}
