/**
 * Whether the login form must show the sign-in-link (magic link) variant.
 *
 * With passwords off and magic link on, the password form is unusable, so the
 * link form is the only sensible one. Otherwise the user's toggle decides.
 */
export function isMagicLinkMode(opts: {
  hasPassword: boolean
  hasMagicLink: boolean
  toggled: boolean
}): boolean {
  if (opts.hasMagicLink && !opts.hasPassword) return true
  return opts.toggled
}
