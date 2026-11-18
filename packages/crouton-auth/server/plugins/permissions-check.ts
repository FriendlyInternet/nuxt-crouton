/**
 * Permissions startup check (#4104)
 *
 * The Better Auth instance is created lazily on the first request, so a bad
 * `crouton.auth.teams.roles` would otherwise only fail then. Check it at boot:
 * the owner must keep `team:manage`, and only owner/admin/member are base roles.
 */
import { validateBaseRoles } from '../lib/access'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const roles = (config.public?.crouton as { auth?: { teams?: { roles?: Record<string, string[]> } } } | undefined)
    ?.auth?.teams?.roles
  validateBaseRoles(roles)
})
