<script setup lang="ts">
// Try to use auth if available (crouton-auth is an optional peer dep)
const auth = tryUseAuth()
const loggedIn = computed(() => auth?.loggedIn?.value ?? false)
const user = computed(() => auth?.user?.value ?? null)
const isSuperAdmin = computed(() => (user.value as any)?.superAdmin === true)

function tryUseAuth() {
  try {
    return useAuth()
  } catch {
    return null
  }
}

function tryUseTeam() {
  try {
    return useTeam()
  } catch {
    return null
  }
}

function tryUseSession() {
  try {
    return useSession()
  } catch {
    return null
  }
}

const teamComposable = tryUseTeam()
const sessionComposable = tryUseSession()

const teams = computed(() => teamComposable?.teams?.value ?? [])
const canCreateTeam = computed(() => teamComposable?.canCreateTeam?.value ?? false)
const isPending = computed(() => sessionComposable?.isPending?.value ?? false)

const showCreateTeamModal = ref(false)

const { t } = useI18n()
const colorMode = useColorMode()
const toggleColorMode = () => {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

function handleTeamCreated(team: { slug: string }) {
  showCreateTeamModal.value = false
  navigateTo(`/admin/${team.slug}`)
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-(--ui-bg) p-4">
    <!-- Top-right utility pill (matches public layout nav) -->
    <div class="fixed top-4 right-4 sm:top-6 sm:right-6 z-50 flex items-center gap-1 bg-(--ui-bg-muted)/80 backdrop-blur-sm rounded-full border border-(--ui-border) shadow-lg px-2 py-1">
      <ClientOnly>
        <CroutonUserPill v-if="loggedIn" placement="inline" use-modal :show-status="false" />

        <USeparator
          v-if="loggedIn"
          orientation="vertical"
          class="h-5 mx-1"
        />
      </ClientOnly>

      <!-- Language Switcher -->
      <CroutonI18nLanguageSwitcher class="w-auto" />

      <!-- Dark/Light Mode Toggle -->
      <ClientOnly>
        <UButton
          :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="toggleColorMode"
        />
      </ClientOnly>
    </div>

    <div class="max-w-2xl w-full space-y-8">
      <!-- Header -->
      <div class="text-center space-y-2">
        <div class="flex items-center justify-center gap-2 text-(--ui-primary)">
          <UIcon
            name="i-lucide-croissant"
            class="size-8"
          />
        </div>
        <h1 class="text-3xl font-bold text-(--ui-text-highlighted)">
          Crouton
        </h1>
      </div>

      <!-- Auth-aware content -->
      <ClientOnly>
        <!-- Loading state -->
        <div
          v-if="isPending"
          class="py-12 text-center text-(--ui-text-dimmed)"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="size-6 animate-spin mx-auto mb-2"
          />
        </div>

        <!-- Logged in: Team cards -->
        <template v-else-if="loggedIn">
          <p class="text-center text-sm text-(--ui-text-muted)">
            {{ $t('home.yourTeams') }}
          </p>

          <div class="grid gap-4 sm:grid-cols-2">
            <!-- Team cards -->
            <UCard
              v-for="team in teams"
              :key="team.id"
              class="hover:bg-(--ui-bg-elevated)/50 transition-colors"
            >
              <div class="flex items-center gap-3 mb-4">
                <UAvatar
                  v-if="team.logo"
                  :src="team.logo"
                  :alt="team.name"
                  size="lg"
                />
                <div
                  v-else
                  class="flex items-center justify-center size-10 rounded-full bg-(--ui-bg-elevated)"
                >
                  <UIcon
                    name="i-lucide-building-2"
                    class="size-5 text-(--ui-text-dimmed)"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <h3 class="font-semibold text-(--ui-text-highlighted) truncate">
                    {{ team.name }}
                  </h3>
                  <p class="text-xs text-(--ui-text-dimmed) truncate">
                    /{{ team.slug }}
                  </p>
                </div>
              </div>
              <div class="flex gap-2">
                <UButton
                  :to="`/admin/${team.slug}`"
                  size="sm"
                  variant="soft"
                  class="flex-1"
                >
                  <UIcon name="i-lucide-layout-grid" />
                  {{ $t('home.admin') }}
                </UButton>
                <UButton
                  :to="`/${team.slug}`"
                  size="sm"
                  variant="outline"
                  class="flex-1"
                >
                  <UIcon name="i-lucide-globe" />
                  {{ $t('home.website') }}
                </UButton>
              </div>
            </UCard>

            <!-- Create team card -->
            <UCard
              v-if="canCreateTeam"
              class="h-full hover:bg-(--ui-bg-elevated)/50 transition-colors cursor-pointer border-dashed"
              @click="showCreateTeamModal = true"
            >
              <div class="flex flex-col items-center justify-center gap-2 py-4 text-(--ui-text-dimmed)">
                <UIcon
                  name="i-lucide-plus"
                  class="size-8"
                />
                <span class="text-sm font-medium">{{ $t('home.createTeam') }}</span>
              </div>
            </UCard>
          </div>

          <!-- Super admin shortcut -->
          <div
            v-if="isSuperAdmin"
            class="pt-2"
          >
            <UButton
              to="/super-admin"
              size="lg"
              variant="outline"
              block
            >
              <UIcon name="i-lucide-shield-check" />
              {{ $t('home.superAdmin') }}
            </UButton>
          </div>
        </template>

        <!-- Logged out: Login / Register -->
        <template v-else>
          <p class="text-center text-sm text-(--ui-text-muted)">
            {{ $t('home.signInToGetStarted') }}
          </p>
          <div class="space-y-3">
            <UButton
              to="/auth/login"
              size="lg"
              block
            >
              <UIcon name="i-lucide-log-in" />
              {{ $t('home.login') }}
            </UButton>
            <UButton
              to="/auth/register"
              size="lg"
              variant="outline"
              block
            >
              <UIcon name="i-lucide-user-plus" />
              {{ $t('home.register') }}
            </UButton>
          </div>
        </template>
      </ClientOnly>

      <!-- Footer -->
      <p class="text-center text-xs text-(--ui-text-dimmed)">
        <a
          href="https://friendlyintern.net"
          target="_blank"
          class="hover:text-(--ui-text-muted)"
        >
          friendlyintern.net
        </a>
      </p>
    </div>

    <!-- Account Settings Modal (opened via useUserMenuItems with useModal) -->
    <AccountSettingsModal />

    <!-- Create Team Modal -->
    <UModal v-model:open="showCreateTeamModal">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            {{ $t('home.createTeam') }}
          </h3>
          <TeamCreateForm
            @success="handleTeamCreated"
            @cancel="close"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
