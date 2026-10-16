<script setup lang="ts">
/**
 * Contact Block Public Renderer
 *
 * Renders a contact card with name, email, phone, role, company, website.
 * Supports manual entry or team member mode.
 * Supports vertical (centered) and horizontal (side-by-side) layouts.
 */
import type { ContactBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: ContactBlockAttrs
}

const props = defineProps<Props>()
const { t } = useT()

const displayName = computed(() => {
  const { firstName, lastName } = props.attrs
  if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(' ')
  return null
})

const initials = computed(() => {
  const { firstName, lastName } = props.attrs
  const f = firstName?.charAt(0) || ''
  const l = lastName?.charAt(0) || ''
  return (f + l).toUpperCase() || null
})

const hasContactInfo = computed(() => {
  const { email, phone, website, company } = props.attrs
  return !!(email || phone || website || company)
})

const isHorizontal = computed(() => props.attrs.layout === 'horizontal')
const showAvatar = computed(() => props.attrs.showAvatar !== false)
</script>

<template>
  <div class="contact-block flex justify-center">
    <div
      class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg)] p-6 transition-shadow hover:shadow-lg"
      :class="isHorizontal ? 'max-w-lg' : 'max-w-sm'"
    >
      <!-- Horizontal Layout -->
      <template v-if="isHorizontal">
        <div class="flex items-start gap-4">
          <!-- Avatar -->
          <UAvatar
            v-if="showAvatar"
            :src="attrs.avatar"
            :text="initials || '?'"
            :alt="displayName || t('pages.blockLibrary.contact.name')"
            size="xl"
            class="shrink-0"
          />

          <!-- Info -->
          <div class="min-w-0 flex-1">
            <h3
              v-if="displayName"
              class="text-lg font-semibold text-[var(--ui-text-highlighted)]"
            >
              {{ displayName }}
            </h3>

            <p
              v-if="attrs.role"
              class="text-sm text-[var(--ui-text-muted)] mt-0.5"
            >
              {{ attrs.role }}
            </p>

            <p
              v-if="attrs.company"
              class="text-sm text-[var(--ui-text-muted)]"
            >
              {{ attrs.company }}
            </p>

            <!-- Contact Details (inline) -->
            <div v-if="hasContactInfo" class="mt-3 space-y-1.5">
              <a
                v-if="attrs.email"
                :href="`mailto:${attrs.email}`"
                class="flex items-center gap-2 text-sm text-[var(--ui-text-muted)] hover:text-[var(--ui-text-highlighted)] transition-colors group"
              >
                <UIcon name="i-lucide-mail" class="size-4 shrink-0 text-[var(--ui-text-dimmed)] group-hover:text-primary transition-colors" />
                <span class="truncate">{{ attrs.email }}</span>
              </a>

              <a
                v-if="attrs.phone"
                :href="`tel:${attrs.phone}`"
                class="flex items-center gap-2 text-sm text-[var(--ui-text-muted)] hover:text-[var(--ui-text-highlighted)] transition-colors group"
              >
                <UIcon name="i-lucide-phone" class="size-4 shrink-0 text-[var(--ui-text-dimmed)] group-hover:text-primary transition-colors" />
                <span>{{ attrs.phone }}</span>
              </a>

              <a
                v-if="attrs.website"
                :href="attrs.website.startsWith('http') ? attrs.website : `https://${attrs.website}`"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2 text-sm text-[var(--ui-text-muted)] hover:text-[var(--ui-text-highlighted)] transition-colors group"
              >
                <UIcon name="i-lucide-globe" class="size-4 shrink-0 text-[var(--ui-text-dimmed)] group-hover:text-primary transition-colors" />
                <span class="truncate">{{ attrs.website }}</span>
              </a>
            </div>
          </div>
        </div>
      </template>

      <!-- Vertical Layout (default) -->
      <template v-else>
        <!-- Avatar + Name -->
        <div class="flex flex-col items-center text-center mb-4">
          <UAvatar
            v-if="showAvatar"
            :src="attrs.avatar"
            :text="initials || '?'"
            :alt="displayName || t('pages.blockLibrary.contact.name')"
            size="xl"
            class="mb-3"
          />

          <h3
            v-if="displayName"
            class="text-lg font-semibold text-[var(--ui-text-highlighted)]"
          >
            {{ displayName }}
          </h3>

          <p
            v-if="attrs.role"
            class="text-sm text-[var(--ui-text-muted)] mt-0.5"
          >
            {{ attrs.role }}
          </p>

          <p
            v-if="attrs.company"
            class="text-sm text-[var(--ui-text-muted)]"
          >
            {{ attrs.company }}
          </p>
        </div>

        <!-- Contact Details -->
        <div v-if="hasContactInfo" class="space-y-2 pt-4 border-t border-[var(--ui-border)]">
          <a
            v-if="attrs.email"
            :href="`mailto:${attrs.email}`"
            class="flex items-center gap-2 text-sm text-[var(--ui-text-muted)] hover:text-[var(--ui-text-highlighted)] transition-colors group"
          >
            <UIcon name="i-lucide-mail" class="size-4 shrink-0 text-[var(--ui-text-dimmed)] group-hover:text-primary transition-colors" />
            <span class="truncate">{{ attrs.email }}</span>
          </a>

          <a
            v-if="attrs.phone"
            :href="`tel:${attrs.phone}`"
            class="flex items-center gap-2 text-sm text-[var(--ui-text-muted)] hover:text-[var(--ui-text-highlighted)] transition-colors group"
          >
            <UIcon name="i-lucide-phone" class="size-4 shrink-0 text-[var(--ui-text-dimmed)] group-hover:text-primary transition-colors" />
            <span>{{ attrs.phone }}</span>
          </a>

          <a
            v-if="attrs.website"
            :href="attrs.website.startsWith('http') ? attrs.website : `https://${attrs.website}`"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 text-sm text-[var(--ui-text-muted)] hover:text-[var(--ui-text-highlighted)] transition-colors group"
          >
            <UIcon name="i-lucide-globe" class="size-4 shrink-0 text-[var(--ui-text-dimmed)] group-hover:text-primary transition-colors" />
            <span class="truncate">{{ attrs.website }}</span>
          </a>
        </div>
      </template>

      <!-- Empty State -->
      <div
        v-if="!displayName && !hasContactInfo"
        class="text-center py-4 text-[var(--ui-text-dimmed)]"
      >
        <UIcon name="i-lucide-user" class="size-8 mb-2" />
        <p class="text-sm">{{ t('pages.blockRender.noContactInfo') }}</p>
      </div>
    </div>
  </div>
</template>
