/**
 * Composable for booking email functionality
 *
 * Provides:
 * - Email enabled status check
 * - Resend email action
 */
export function useBookingEmail() {
  const config = useRuntimeConfig()
  const { t } = useT()

  /**
   * Check if email module is enabled
   */
  const isEmailEnabled = computed(() => {
    return (config.public as any).croutonBookings?.email?.enabled === true
  })

  /**
   * Resend an email for a booking
   *
   * @param teamId - Team ID
   * @param bookingId - Booking ID
   * @param triggerType - Type of email to resend
   */
  async function resendEmail(
    teamId: string,
    bookingId: string,
    triggerType: 'booking_created' | 'reminder_before' | 'booking_cancelled' | 'follow_up_after'
  ): Promise<{ success: boolean; error?: string }> {
    if (!isEmailEnabled.value) {
      return {
        success: false,
        error: t('bookings.notifications.emailNotEnabled')
      }
    }

    try {
      await $fetch(`/api/crouton-bookings/teams/${teamId}/bookings/${bookingId}/resend-email`, {
        method: 'POST',
        body: { triggerType }
      })

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        error: error.data?.statusMessage || error.message || t('bookings.notifications.resendFailed')
      }
    }
  }

  return {
    isEmailEnabled,
    resendEmail
  }
}
