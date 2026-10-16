<script setup lang="ts">
/**
 * Two-Factor Authentication Setup Component
 *
 * Enables/disables 2FA with TOTP authenticator app.
 * Shows QR code for setup and manages backup codes.
 *
 * @example
 * ```vue
 * <AccountTwoFactorSetup />
 * ```
 */
import type { TwoFactorStatus } from '../../composables/useAuth'

interface Props {
  /** External loading state */
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
})

const { t } = useT()
const {
  has2FA,
  enable2FA,
  disable2FA,
  verifyTotp,
  generateBackupCodes,
  get2FAStatus
} = useTwoFactor()

// Helper to extract secret from TOTP URI
function extractSecretFromUri(uri: string): string {
  try {
    const url = new URL(uri)
    return url.searchParams.get('secret') || ''
  } catch {
    return ''
  }
}
const notify = useNotify()

// States
const status = ref<TwoFactorStatus>({
  enabled: false,
  hasTotp: false,
  hasBackupCodes: false
})
const statusLoading = ref(false)

// Setup flow states
const showSetupModal = ref(false)
const setupStep = ref<'password' | 'qr' | 'verify' | 'backup'>('password')
const totpUri = ref('')
const totpSecret = ref('')
const backupCodes = ref<string[]>([])

// Form states
const passwordInput = ref('')
const verifyCode = ref('')

// Loading states
const setupLoading = ref(false)
const disableLoading = ref(false)
const viewCodesLoading = ref(false)

const _isLoading = computed(() => props.loading || statusLoading.value)

// Load 2FA status
async function loadStatus() {
  statusLoading.value = true
  try {
    status.value = await get2FAStatus()
  } catch (e) {
    // Silently fail - status will show as disabled
    console.error('Failed to load 2FA status:', e)
  } finally {
    statusLoading.value = false
  }
}

// Initialize
onMounted(() => {
  if (has2FA.value) {
    loadStatus()
  }
})

// Start setup flow
function startSetup() {
  setupStep.value = 'password'
  passwordInput.value = ''
  verifyCode.value = ''
  totpUri.value = ''
  totpSecret.value = ''
  backupCodes.value = []
  showSetupModal.value = true
}

// Handle password submission for setup
async function handlePasswordSubmit() {
  if (!passwordInput.value) return

  setupLoading.value = true
  try {
    const data = await enable2FA(passwordInput.value)
    totpUri.value = data.totpURI
    totpSecret.value = extractSecretFromUri(data.totpURI)
    backupCodes.value = data.backupCodes
    setupStep.value = 'qr'
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('account.twoFactor.failedToEnable')
    notify.error(t('common.error'), { description: message })
  } finally {
    setupLoading.value = false
  }
}

// Handle TOTP verification
async function handleVerifySubmit() {
  if (!verifyCode.value || verifyCode.value.length !== 6) {
    notify.error(t('account.twoFactor.invalidCode'), { description: t('auth.twoFactor.enter6DigitCode') })
    return
  }

  setupLoading.value = true
  try {
    await verifyTotp({ code: verifyCode.value })

    // Generate backup codes
    const codes = await generateBackupCodes(passwordInput.value)
    backupCodes.value = codes

    setupStep.value = 'backup'
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('account.twoFactor.invalidCode')
    notify.error(t('common.error'), { description: message })
  } finally {
    setupLoading.value = false
  }
}

// Complete setup
async function completeSetup() {
  showSetupModal.value = false
  await loadStatus()
  notify.success(t('account.twoFactor.enabled'), { description: t('account.twoFactor.enabledDescription') })
}

// Disable 2FA
const showDisableModal = ref(false)
const disablePassword = ref('')

async function handleDisable() {
  if (!disablePassword.value) return

  disableLoading.value = true
  try {
    await disable2FA(disablePassword.value)

    showDisableModal.value = false
    disablePassword.value = ''
    await loadStatus()

    notify.success(t('account.twoFactor.disabled'), { description: t('account.twoFactor.disabledDescription') })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('account.twoFactor.failedToDisable')
    notify.error(t('common.error'), { description: message })
  } finally {
    disableLoading.value = false
  }
}

// View/regenerate backup codes
const showBackupModal = ref(false)
const backupPassword = ref('')
const viewedBackupCodes = ref<string[]>([])

async function handleViewBackupCodes() {
  if (!backupPassword.value) return

  viewCodesLoading.value = true
  try {
    // Better Auth 1.4.x: Uses generateBackupCodes which regenerates codes
    // Previous codes are invalidated when generating new ones
    viewedBackupCodes.value = await generateBackupCodes(backupPassword.value)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('account.twoFactor.failedToGenerateCodes')
    notify.error(t('common.error'), { description: message })
  } finally {
    viewCodesLoading.value = false
  }
}

// Copy backup codes
async function copyBackupCodes(codes: string[]) {
  const text = codes.join('\n')
  await navigator.clipboard.writeText(text)
  notify.success(t('account.twoFactor.copied'), { description: t('account.twoFactor.codesCopied') })
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">
          {{ t('account.twoFactorAuth') }}
        </h3>
        <p class="text-sm text-muted mt-1">
          {{ t('account.twoFactorDescription') }}
        </p>
      </div>
    </div>

    <!-- 2FA not enabled in app -->
    <UAlert
      v-if="!has2FA"
      color="info"
      icon="i-lucide-info"
      :title="t('account.twoFactorNotEnabled')"
      :description="t('account.twoFactorNotEnabledDesc')"
    />

    <!-- Loading -->
    <div
      v-else-if="statusLoading"
      class="space-y-3"
    >
      <USkeleton class="h-20 w-full rounded-lg" />
    </div>

    <!-- 2FA Status -->
    <div v-else>
      <!-- Enabled -->
      <div
        v-if="status.enabled"
        class="p-4 rounded-lg border border-success/30 bg-success/5"
      >
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 rounded-lg bg-success/10">
            <UIcon
              name="i-lucide-shield-check"
              class="size-5 text-success"
            />
          </div>
          <div class="flex-1">
            <p class="font-medium text-success">
              {{ t('account.twoFactorEnabled') }}
            </p>
            <p class="text-sm text-muted">
              {{ t('account.twoFactorEnabledDesc') }}
            </p>
          </div>
        </div>

        <div class="flex gap-3 mt-4">
          <UButton
            variant="soft"
            icon="i-lucide-key"
            @click="showBackupModal = true; backupPassword = ''; viewedBackupCodes = []"
          >
            {{ t('account.viewBackupCodes') }}
          </UButton>
          <UButton
            variant="ghost"
            color="error"
            icon="i-lucide-shield-off"
            @click="showDisableModal = true; disablePassword = ''"
          >
            {{ t('account.disable2FA') }}
          </UButton>
        </div>
      </div>

      <!-- Not enabled -->
      <div
        v-else
        class="p-4 rounded-lg border border-warning/30 bg-warning/5"
      >
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 rounded-lg bg-warning/10">
            <UIcon
              name="i-lucide-shield-alert"
              class="size-5 text-warning"
            />
          </div>
          <div class="flex-1">
            <p class="font-medium text-warning">
              {{ t('account.twoFactorDisabled') }}
            </p>
            <p class="text-sm text-muted">
              {{ t('account.twoFactorDisabledDesc') }}
            </p>
          </div>
        </div>

        <UButton
          class="mt-4"
          icon="i-lucide-shield-plus"
          @click="startSetup"
        >
          {{ t('account.enable2FA') }}
        </UButton>
      </div>
    </div>

    <!-- Info -->
    <UAlert
      v-if="has2FA"
      color="info"
      variant="soft"
      icon="i-lucide-smartphone"
    >
      <template #title>
        {{ t('account.aboutTwoFactor') }}
      </template>
      <template #description>
        {{ t('account.aboutTwoFactorDesc') }}
      </template>
    </UAlert>

    <!-- Setup Modal -->
    <UModal
      v-model:open="showSetupModal"
      :dismissible="setupStep === 'password'"
    >
      <template #content>
        <div class="p-6 space-y-6">
          <!-- Step: Password -->
          <div v-if="setupStep === 'password'">
            <h3 class="text-lg font-semibold">
              {{ t('account.enableTwoFactor') }}
            </h3>
            <p class="text-sm text-muted mt-1">
              {{ t('account.enterPasswordToContinue') }}
            </p>

            <div class="mt-4">
              <UInput
                v-model="passwordInput"
                type="password"
                :placeholder="t('account.enterYourPassword')"
                icon="i-lucide-lock"
                :disabled="setupLoading"
                @keyup.enter="handlePasswordSubmit"
              />
            </div>

            <div class="flex justify-end gap-3 mt-6">
              <UButton
                variant="ghost"
                :disabled="setupLoading"
                @click="showSetupModal = false"
              >
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                :loading="setupLoading"
                :disabled="!passwordInput"
                @click="handlePasswordSubmit"
              >
                {{ t('common.next') }}
              </UButton>
            </div>
          </div>

          <!-- Step: QR Code -->
          <div v-else-if="setupStep === 'qr'">
            <h3 class="text-lg font-semibold">
              {{ t('account.scanQrCode') }}
            </h3>
            <p class="text-sm text-muted mt-1">
              {{ t('account.scanQrCodeDesc') }}
            </p>

            <div class="flex flex-col items-center gap-4 mt-4">
              <!-- Rendered locally — the TOTP secret never leaves the device -->
              <CroutonQrCode v-if="totpUri" :data="totpUri" :size="200" />

              <div class="text-center">
                <p class="text-sm text-muted">
                  {{ t('account.orEnterManually') }}
                </p>
                <code class="text-sm font-mono bg-muted px-2 py-1 rounded mt-1 inline-block">
                  {{ totpSecret }}
                </code>
              </div>
            </div>

            <div class="flex justify-end gap-3 mt-6">
              <UButton
                variant="ghost"
                @click="setupStep = 'password'"
              >
                {{ t('common.back') }}
              </UButton>
              <UButton @click="setupStep = 'verify'">
                {{ t('common.next') }}
              </UButton>
            </div>
          </div>

          <!-- Step: Verify -->
          <div v-else-if="setupStep === 'verify'">
            <h3 class="text-lg font-semibold">
              {{ t('account.verifyCode') }}
            </h3>
            <p class="text-sm text-muted mt-1">
              {{ t('account.verifyCodeDesc') }}
            </p>

            <div class="mt-4">
              <UInput
                v-model="verifyCode"
                placeholder="000000"
                icon="i-lucide-hash"
                maxlength="6"
                class="text-center font-mono text-lg"
                :disabled="setupLoading"
                @keyup.enter="handleVerifySubmit"
              />
            </div>

            <div class="flex justify-end gap-3 mt-6">
              <UButton
                variant="ghost"
                :disabled="setupLoading"
                @click="setupStep = 'qr'"
              >
                {{ t('common.back') }}
              </UButton>
              <UButton
                :loading="setupLoading"
                :disabled="verifyCode.length !== 6"
                @click="handleVerifySubmit"
              >
                {{ t('auth.verify') }}
              </UButton>
            </div>
          </div>

          <!-- Step: Backup Codes -->
          <div v-else-if="setupStep === 'backup'">
            <h3 class="text-lg font-semibold">
              {{ t('account.saveBackupCodes') }}
            </h3>
            <p class="text-sm text-muted mt-1">
              {{ t('account.saveBackupCodesDesc') }}
            </p>

            <UAlert
              color="warning"
              variant="soft"
              icon="i-lucide-alert-triangle"
              class="mt-4"
            >
              <template #description>
                {{ t('account.backupCodesWarning') }}
              </template>
            </UAlert>

            <div class="grid grid-cols-2 gap-2 mt-4 p-4 bg-muted rounded-lg">
              <code
                v-for="code in backupCodes"
                :key="code"
                class="font-mono text-sm"
              >
                {{ code }}
              </code>
            </div>

            <div class="flex justify-between mt-6">
              <UButton
                variant="soft"
                icon="i-lucide-copy"
                @click="copyBackupCodes(backupCodes)"
              >
                {{ t('account.copyCodes') }}
              </UButton>
              <UButton @click="completeSetup">
                {{ t('common.close') }}
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Disable Modal -->
    <UModal v-model:open="showDisableModal">
      <template #content>
        <div class="p-6 space-y-6">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center size-10 rounded-full bg-error/10">
              <UIcon
                name="i-lucide-shield-off"
                class="size-5 text-error"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold">
                {{ t('account.disable2FA') }}
              </h3>
              <p class="text-sm text-muted">
                {{ t('account.disableTwoFactorWarning') }}
              </p>
            </div>
          </div>

          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-alert-triangle"
          >
            <template #description>
              {{ t('account.disableTwoFactorDesc') }}
            </template>
          </UAlert>

          <UInput
            v-model="disablePassword"
            type="password"
            :placeholder="t('account.enterPasswordToConfirm')"
            icon="i-lucide-lock"
            :disabled="disableLoading"
          />

          <div class="flex justify-end gap-3">
            <UButton
              variant="ghost"
              :disabled="disableLoading"
              @click="showDisableModal = false"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="error"
              :loading="disableLoading"
              :disabled="!disablePassword"
              @click="handleDisable"
            >
              {{ t('account.disable2FA') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- View Backup Codes Modal -->
    <UModal v-model:open="showBackupModal">
      <template #content>
        <div class="p-6 space-y-6">
          <h3 class="text-lg font-semibold">
            {{ t('account.backupCodes') }}
          </h3>

          <!-- Password entry -->
          <div v-if="viewedBackupCodes.length === 0">
            <p class="text-sm text-muted">
              {{ t('account.enterPasswordToViewCodes') }}
            </p>

            <UInput
              v-model="backupPassword"
              type="password"
              :placeholder="t('account.enterYourPassword')"
              icon="i-lucide-lock"
              class="mt-4"
              :disabled="viewCodesLoading"
              @keyup.enter="handleViewBackupCodes"
            />

            <div class="flex justify-end gap-3 mt-6">
              <UButton
                variant="ghost"
                :disabled="viewCodesLoading"
                @click="showBackupModal = false"
              >
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                :loading="viewCodesLoading"
                :disabled="!backupPassword"
                @click="handleViewBackupCodes"
              >
                {{ t('account.viewCodes') }}
              </UButton>
            </div>
          </div>

          <!-- Show codes -->
          <div v-else>
            <div class="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg">
              <div
                v-for="code in viewedBackupCodes"
                :key="code"
                class="flex items-center gap-2"
              >
                <code class="font-mono text-sm">
                  {{ code }}
                </code>
              </div>
            </div>

            <p class="text-sm text-muted mt-4">
              {{ t('account.codesRemaining', { count: viewedBackupCodes.length }) }}
            </p>

            <div class="flex justify-between mt-6">
              <UButton
                variant="soft"
                icon="i-lucide-copy"
                @click="copyBackupCodes(viewedBackupCodes)"
              >
                {{ t('account.copyCodes') }}
              </UButton>
              <UButton @click="showBackupModal = false">
                {{ t('common.close') }}
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
