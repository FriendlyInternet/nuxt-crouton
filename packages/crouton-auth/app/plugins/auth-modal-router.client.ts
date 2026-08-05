/**
 * Auth Modal Router Plugin
 *
 * Intercepts client-side navigations to /auth/* routes and shows them
 * as a UModal overlay instead of performing a full page transition.
 * The URL is still updated via history.pushState for deep-linking.
 *
 * Fresh page loads (from.matched.length === 0) are NOT intercepted
 * so direct URL entry and email links continue to use the full auth layout.
 */
import type { AuthModalMode } from '../composables/useAuthModal'

const AUTH_PATHS: Record<string, AuthModalMode> = {
  '/auth/login': 'login',
  '/auth/register': 'register',
  '/auth/forgot-password': 'forgot-password'
}

export default defineNuxtPlugin(() => {
  const router = useRouter()

  router.beforeEach((to, from) => {
    const mode = AUTH_PATHS[to.path]

    // Only intercept in-app navigations (from.matched.length === 0 = fresh page load)
    if (!mode || from.matched.length === 0) {
      return
    }

    const authModal = useAuthModal()
    const pending = authModal.state.value

    // A guard bounce can re-intercept while the modal is already open with a
    // deep-link target pending — e.g. /auth/login?redirect=X navigates to '/',
    // whose auth guard resolves logged-out and fires a bare navigateTo
    //('/auth/login'). Resetting to '/' here would clobber X and strand the
    // user on the root page after sign-in (#1323). No explicit ?redirect= on
    // the incoming navigation → keep the pending target.
    const redirectTo = (to.query.redirect as string) || (pending.open ? pending.redirectTo : '/')
    const previousPath = pending.open ? pending.previousPath : from.fullPath
    const prefillEmail = (to.query.email as string) || undefined
    // Convenience prefill for shared demo/preview links — fills the field but
    // never auto-submits. Only for throwaway demo credentials (a password in a
    // URL is logged in history / proxies / Referer).
    const prefillPassword = (to.query.password as string) || undefined
    // A "staff door" link (e.g. on a scoped kassa page) passes ?dismissible=1
    // so the modal can be closed back to the page behind it (which re-asserts
    // its own gate). Hard auth redirects omit it and stay non-dismissable.
    const dismissible = to.query.dismissible === '1' || to.query.dismissible === 'true'

    // Update visible URL without triggering navigation
    window.history.pushState(null, '', to.fullPath)

    // Open the auth modal
    authModal.open(mode, redirectTo, previousPath, prefillEmail, dismissible, prefillPassword)

    // Cancel the router navigation
    return false
  })
})
