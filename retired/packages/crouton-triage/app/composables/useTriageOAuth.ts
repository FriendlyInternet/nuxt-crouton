/**
 * Composable for handling OAuth flows in popup windows
 *
 * Manages OAuth authorization flow with popup window for Slack/other integrations.
 * Preserves form state during OAuth by using popup instead of full-page redirect.
 *
 * @example
 * ```ts
 * const { openOAuthPopup, waitingForOAuth } = useTriageOAuth({
 *   teamId: currentTeam.value.id,
 *   onSuccess: (credentials) => {
 *     // Merge credentials into form
 *     state.value.apiToken = credentials.apiToken
 *     state.value.sourceMetadata = credentials.sourceMetadata
 *   }
 * })
 *
 * // In template
 * <UButton @click="openOAuthPopup">Connect with Slack</UButton>
 * ```
 */

import type { Ref } from 'vue'
import { useEventListener } from '@vueuse/core'

export interface OAuthCredentials {
  apiToken: string
  sourceMetadata: Record<string, any>
  /** Connected account ID (when OAuth creates/updates an account) */
  accountId?: string
}

export interface OAuthConfig {
  /**
   * Team ID for OAuth flow
   */
  teamId: string

  /**
   * Flow ID to add the input to (optional - if not provided, will use first flow or create new)
   * Can be a ref for reactive updates
   */
  flowId?: string | Ref<string | undefined>

  /**
   * Slack workspace name or team ID to pre-select during OAuth
   * Accepts: workspace subdomain (e.g. "myteam"), full URL ("myteam.slack.com"), or team ID ("T12345")
   * Can be a ref for reactive updates
   */
  slackTeam?: string | Ref<string | undefined>

  /**
   * Callback when OAuth succeeds
   */
  onSuccess?: (credentials: OAuthCredentials) => void

  /**
   * Callback when OAuth fails
   */
  onError?: (error: Error) => void

  /**
   * OAuth provider (slack, figma, etc.)
   * @default 'slack'
   */
  provider?: string
}

export function useTriageOAuth(config: OAuthConfig) {
  const { teamId, flowId: flowIdInput, slackTeam: slackTeamInput, onSuccess, onError, provider = 'slack' } = config

  // Support both static and reactive flowId
  const flowId = computed(() => {
    if (flowIdInput === undefined) return undefined
    return isRef(flowIdInput) ? flowIdInput.value : flowIdInput
  })

  // Support both static and reactive slackTeam
  const slackTeam = computed(() => {
    if (slackTeamInput === undefined) return undefined
    return isRef(slackTeamInput) ? slackTeamInput.value : slackTeamInput
  })

  const waitingForOAuth = ref(false)
  const notify = useNotify()

  /**
   * Build OAuth install URL
   */
  const oauthInstallUrl = computed(() => {
    if (!teamId) return '#'
    const url = new URL(`/api/crouton-triage/oauth/${provider}/install`, window.location.origin)
    url.searchParams.set('teamId', teamId)
    if (flowId.value) {
      url.searchParams.set('flowId', flowId.value)
    }
    if (slackTeam.value) {
      url.searchParams.set('slackTeam', slackTeam.value)
    }
    // Pass opener origin so success page knows where to postMessage
    url.searchParams.set('openerOrigin', window.location.origin)
    return url.pathname + url.search
  })

  /**
   * Open OAuth popup window
   */
  function openOAuthPopup(event?: Event) {
    // Ensure we're on the client
    if (import.meta.server) {
      console.warn('[OAuth Popup] Cannot open popup during SSR')
      return
    }

    // Prevent any default behavior
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }

    waitingForOAuth.value = true

    const width = 600
    const height = 800
    const left = (window.screen.width - width) / 2
    const top = (window.screen.height - height) / 2

    const features = `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`

    // Open popup
    const popup = window.open(
      oauthInstallUrl.value,
      `${provider}-oauth`,
      features
    )

    if (popup) {
      popup.focus()
      notify.info(`Opening ${provider.charAt(0).toUpperCase() + provider.slice(1)} Authorization`, { description: 'Complete the authorization in the popup window' })
    } else {
      console.error('[OAuth Popup] Failed to open popup - check popup blocker')
      waitingForOAuth.value = false
      notify.error('Popup Blocked', { description: 'Please allow popups for this site and try again' })
    }
  }

  /**
   * Handle OAuth success message from popup
   */
  async function handleOAuthMessage(event: MessageEvent) {
    if (event.data?.type === 'oauth-success') {
      // Merge OAuth credentials
      if (event.data.credentials) {

        notify.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} Connected!`, { description: 'OAuth credentials received successfully.' })

        // Call success handler if provided
        if (onSuccess) {
          onSuccess(event.data.credentials)
        }
      }

      // Reset waiting flag
      waitingForOAuth.value = false
    }

    if (event.data?.type === 'oauth-error') {
      notify.error('OAuth Failed', { description: event.data.error || 'Authorization failed. Please try again.' })

      // Call error handler if provided
      if (onError) {
        onError(new Error(event.data.error || 'OAuth failed'))
      }

      waitingForOAuth.value = false
    }
  }

  // Register message listener - auto-removed on unmount (VueUse)
  useEventListener(window, "message", handleOAuthMessage)

  return {
    /**
     * Open OAuth popup window
     */
    openOAuthPopup,

    /**
     * Whether we're waiting for OAuth to complete
     */
    waitingForOAuth,

    /**
     * OAuth install URL (for external use if needed)
     */
    oauthInstallUrl,
  }
}
