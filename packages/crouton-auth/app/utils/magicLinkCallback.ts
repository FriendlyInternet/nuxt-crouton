/**
 * Where the sign-in mail link should land. Only same-origin paths are honoured
 * (no open redirect); anything else falls back to the origin root.
 */
export function magicLinkCallbackURL(origin: string, redirectTo?: string | null): string {
  const isSafePath = typeof redirectTo === 'string'
    && redirectTo.startsWith('/')
    && !redirectTo.startsWith('//')
    && !redirectTo.includes('\\')
  return origin + (isSafePath ? redirectTo : '/')
}
