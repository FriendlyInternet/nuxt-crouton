/**
 * Template sender check (#3135): a template's fromEmail must be on the configured
 * sending domain (domain of runtimeConfig.email.from). Skipped when none is configured.
 */
const domainOf = (addr: string): string => {
  const m = addr.match(/@([^@>\s]+)\s*>?\s*$/)
  return m?.[1]?.toLowerCase() ?? ''
}

export function assertFromEmailOnSendingDomain(event: any, fromEmail: string | undefined | null): void {
  if (!fromEmail) return
  const configured = ((useRuntimeConfig(event) as any)?.email?.from as string | undefined) || ''
  const allowed = domainOf(configured)
  if (!allowed) return
  if (domainOf(fromEmail) !== allowed) {
    throw createError({ status: 400, statusText: `fromEmail must be on the sending domain (${allowed})` })
  }
}
