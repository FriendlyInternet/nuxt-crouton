/**
 * Permissions startup check (#4104)
 *
 * The Better Auth instance is created lazily on the first request, so a bad
 * `croutonAuth.teams.roles` would otherwise only fail then. Check it at boot:
 * the owner must keep `team:manage`, only owner/admin/member are base roles,
 * and no package declares an action named like a Better Auth permission.
 */
import { validateActions, validateBaseRoles, type CroutonActionRegistry } from '../lib/access'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const roles = (config.public?.crouton as { auth?: { teams?: { roles?: Record<string, string[]> } } } | undefined)
    ?.auth?.teams?.roles
  validateBaseRoles(roles)
  validateActions((useAppConfig() as { croutonActions?: CroutonActionRegistry }).croutonActions)
})
