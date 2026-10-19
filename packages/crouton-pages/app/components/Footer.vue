<script setup lang="ts">
/**
 * CroutonPagesFooter
 *
 * Self-contained footer component for use in layouts.
 * Fetches the singleton footer page (pageType: 'pages:footer') and renders it
 * inside a UFooter with block content in #top and sensible defaults in the bottom bar.
 *
 * Renders nothing if no footer page exists — safe to include unconditionally.
 *
 * For custom footer layouts, apps can use useFooterPage() directly instead.
 *
 * @example
 * ```vue
 * <!-- In your layout -->
 * <template>
 *   <div>
 *     <header>...</header>
 *     <main><slot /></main>
 *     <CroutonPagesFooter />
 *   </div>
 * </template>
 * ```
 */
import { detectContentFormat } from '../utils/content-detector'

const { footer, content, isLoading } = useFooterPage()

const contentFormat = computed(() => detectContentFormat(content.value))

const year = new Date().getFullYear()

// Try to get social links from site settings if available
const siteInfo = ref<{ socialLinks?: { facebook?: string; instagram?: string } } | null>(null)
try {
  // useTeamSiteInfo is from crouton-admin — may not be available
  const info = (useTeamSiteInfo as any)?.()
  if (info) {
    siteInfo.value = info.siteSettings?.value || null
    watch(() => info.siteSettings?.value, (v: any) => { siteInfo.value = v }, { immediate: true })
  }
} catch {
  // useTeamSiteInfo not available — no social links
}

const socialLinks = computed(() => {
  const links: Array<{ icon: string; to: string; label: string }> = []
  const social = siteInfo.value?.socialLinks
  if (social?.facebook) {
    links.push({ icon: 'i-lucide-facebook', to: social.facebook, label: 'Facebook' })
  }
  if (social?.instagram) {
    links.push({ icon: 'i-lucide-instagram', to: social.instagram, label: 'Instagram' })
  }
  return links
})
</script>

<template>
  <UFooter v-if="footer && !isLoading">
    <template #top>
      <UContainer>
        <CroutonPagesBlockContent
          v-if="contentFormat === 'blocks'"
          :content="content"
        />
        <CroutonPagesRegularContent
          v-else-if="contentFormat === 'html'"
          :content="content"
        />
      </UContainer>
    </template>

    <template #left>
      <p class="text-sm text-muted">
        &copy; {{ year }}
      </p>
    </template>

    <template v-if="socialLinks.length" #right>
      <UButton
        v-for="link in socialLinks"
        :key="link.label"
        :icon="link.icon"
        color="neutral"
        variant="ghost"
        :to="link.to"
        target="_blank"
        :aria-label="link.label"
      />
    </template>
  </UFooter>
</template>
