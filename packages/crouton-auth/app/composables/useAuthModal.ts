/**
 * useAuthModal
 *
 * Shared reactive state for the auth route modal.
 * Used by the router plugin (to open) and AuthRouteModal component (to render).
 */
import { sanitizeRedirectUrl } from '../utils/security'

export type AuthModalMode = 'login' | 'register' | 'forgot-password'

interface AuthModalState {
  open: boolean
  mode: AuthModalMode
  redirectTo: string
  previousPath: string
  prefillEmail?: string
  /**
   * Pre-fills the login/register password field (e.g. from a `?password=`
   * link shared for a demo/preview). The form is filled but NOT submitted —
   * the user still clicks Sign in. Convenience only; see the security note on
   * `open()` before sharing such links.
   */
  prefillPassword?: string
  /**
   * When true, the modal can be dismissed (X / Esc / outside-click) and
   * restores `previousPath`. Used by the "staff door" on pages that have their
   * own gate behind them (e.g. a scoped kassa page falls back to the PIN gate),
   * so trying member login is never a dead-end. Hard auth requirements
   * (members/admin 401s) leave this false — there's nothing behind to fall back
   * to, so the only ways out are to succeed or deliberately leave.
   */
  dismissible?: boolean
}

export function useAuthModal() {
  const state = useState<AuthModalState>('crouton-auth-modal', () => ({
    open: false,
    mode: 'login',
    redirectTo: '/',
    previousPath: '/'
  }))

  /**
   * Open the auth modal.
   *
   * `prefillEmail` / `prefillPassword` pre-fill the credential fields without
   * submitting — handy for handing someone a ready-to-go demo/preview link
   * (`/auth/login?email=…&password=…`). SECURITY: a password in a URL lands in
   * browser history, server/proxy access logs and any `Referer` header, so only
   * use this for throwaway demo credentials — never a real account's password.
   */
  function open(mode: AuthModalMode, redirectTo: string, previousPath: string, prefillEmail?: string, dismissible = false, prefillPassword?: string) {
    // redirectTo comes from `?redirect` — keep it on this site (#3143).
    state.value = { open: true, mode, redirectTo: sanitizeRedirectUrl(redirectTo || '/'), previousPath, prefillEmail, prefillPassword, dismissible }
  }

  /**
   * Close the modal and restore the previous URL.
   * Called when the user dismisses the modal without authenticating.
   */
  function close() {
    if (import.meta.client && state.value.open) {
      window.history.replaceState(null, '', state.value.previousPath)
    }
    state.value.open = false
  }

  /**
   * Switch to a different auth mode and update the URL to match.
   * Called when the user clicks "Don't have an account?" etc.
   */
  function setMode(mode: AuthModalMode) {
    state.value.mode = mode
    if (import.meta.client) {
      window.history.replaceState(null, '', `/auth/${mode}`)
    }
  }

  return { state, open, close, setMode }
}
