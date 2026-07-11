<script setup lang="ts">
/**
 * Mailing Block Public Renderer
 *
 * Renders a native email subscription form that posts directly
 * to the configured provider (Mailchimp, etc.).
 * No iframe — the form matches the site's design.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 */
import { ref } from 'vue'
import type { MailingBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: MailingBlockAttrs
}

const props = defineProps<Props>()

const email = ref('')
const submitted = ref(false)
</script>

<template>
  <div class="mailing-block flex justify-center">
    <div class="w-full max-w-md">
      <!-- Title -->
      <h3
        v-if="attrs.title"
        class="text-lg font-semibold text-[var(--ui-text-highlighted)] mb-1"
      >
        {{ attrs.title }}
      </h3>

      <!-- Description -->
      <p
        v-if="attrs.description"
        class="text-sm text-[var(--ui-text-muted)] mb-4"
      >
        {{ attrs.description }}
      </p>

      <!-- No action URL configured -->
      <UAlert
        v-if="!attrs.actionUrl"
        color="neutral"
        icon="i-lucide-mail"
        title="No form URL configured"
        description="Edit this block to enter a subscribe endpoint URL."
      />

      <!-- Success message -->
      <div
        v-else-if="submitted"
        class="flex items-center gap-2 p-3 rounded-lg bg-[var(--ui-bg-elevated)] text-sm text-[var(--ui-text-highlighted)]"
      >
        <UIcon name="i-lucide-check-circle" class="size-5 text-green-500 shrink-0" />
        <span>Thanks for subscribing!</span>
      </div>

      <!-- Subscribe form -->
      <form
        v-else
        :action="attrs.actionUrl"
        method="post"
        target="_blank"
        class="flex gap-2"
        @submit="submitted = true"
      >
        <!-- UInput (not a raw input) so themes reach this public form (#1410) -->
        <UInput
          v-model="email"
          type="email"
          :name="attrs.emailFieldName || 'EMAIL'"
          :placeholder="attrs.placeholder || 'Enter your email'"
          required
          class="flex-1 min-w-0"
        />
        <UButton type="submit" color="primary">
          {{ attrs.buttonLabel || 'Subscribe' }}
        </UButton>

        <!-- Honeypot (bot protection) -->
        <div
          v-if="attrs.honeypotFieldName"
          aria-hidden="true"
          style="position: absolute; left: -5000px;"
        >
          <input
            type="text"
            :name="attrs.honeypotFieldName"
            tabindex="-1"
            value=""
          >
        </div>
      </form>
    </div>
  </div>
</template>
