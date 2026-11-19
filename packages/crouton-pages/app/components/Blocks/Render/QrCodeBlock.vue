<script setup lang="ts">
/**
 * QR Code Block Public Renderer
 *
 * Resolves the linked page id to its canonical public URL (locale- and team-aware)
 * and renders a scannable QR code via `<CroutonQrCode>`. Falls back to a custom
 * absolute URL when no page is selected, mirroring the Button Row block's page-link
 * behaviour.
 */
import type { QrCodeBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: QrCodeBlockAttrs
}

const props = defineProps<Props>()

const { resolve } = usePageLink()
const router = useRouter()

// Origin to turn a resolved page path into the absolute URL a phone camera needs.
const origin = useRequestURL().origin

const href = computed(() => {
  const path = props.attrs.pageId ? resolve(props.attrs.pageId) : undefined
  // router.resolve().href goes through the history's createHref, so on a
  // connected domain the team prefix is stripped (#4175).
  if (path) return new URL(router.resolve(path).href, origin).toString()
  // Custom URL fallback — assumed absolute.
  return props.attrs.url || ''
})

const sizePx = computed(() => ({ sm: 140, md: 200, lg: 280 }[props.attrs.size || 'md']))

const alignClass = computed(() => ({
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end'
}[props.attrs.align || 'center']))
</script>

<template>
  <div v-if="href" class="flex" :class="alignClass">
    <div class="flex flex-col items-center gap-3">
      <CroutonQrCode :data="href" :size="sizePx" />
      <p v-if="attrs.caption" class="text-sm text-muted text-center">
        {{ attrs.caption }}
      </p>
    </div>
  </div>
</template>
