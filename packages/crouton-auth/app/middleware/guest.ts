/**
 * Guest Middleware
 *
 * Protects routes that should only be accessible to unauthenticated users.
 * Redirects authenticated users to the admin.
 *
 * @example
 * ```vue
 * <script setup>
 * definePageMeta({
 *   middleware: 'guest'
 * })
 * </script>
 * ```
 */
import { sanitizeRedirectUrl } from '../utils/security'

export default defineNuxtRouteMiddleware(async (to) => {
  const config = useAuthConfig()
  const redirects = config?.ui?.redirects

  // Skip on server
  if (import.meta.server) return

  const { isAuthenticated, isPending } = useSession()

  // Wait for session to load if pending
  if (isPending.value) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Redirect authenticated users away from guest-only pages
  if (isAuthenticated.value) {
    // Check for redirect query param (e.g., from login page)
    const redirectQuery = to.query.redirect as string | undefined
    const defaultRedirect = redirects?.authenticated ?? '/'

    const redirectPath = redirectQuery ? sanitizeRedirectUrl(redirectQuery) : defaultRedirect

    if (config?.debug) {
      console.log(`[@crouton/auth] Guest middleware: authenticated, redirecting to ${redirectPath}`)
    }

    // Use external: true to force a full browser navigation, not a SPA redirect.
    // Without this, the server renders the login page (auth layout) but the client
    // immediately redirects to the admin page (admin layout), causing a Vue hydration
    // mismatch because the server HTML and client component tree don't match.
    return navigateTo(redirectPath, { replace: true, external: true })
  }

  if (config?.debug) {
    console.log(`[@crouton/auth] Guest middleware: not authenticated, proceeding to ${to.path}`)
  }
})
