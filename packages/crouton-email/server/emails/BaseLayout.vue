<script setup lang="ts">
import {
  EHtml,
  EHead,
  EPreview,
  EBody,
  EContainer,
  ESection,
  EImg,
  EText,
  EHr
} from 'vue-email'
// Brand identity SSOT — shared with the digest renderers. See brand/email-brand.mjs.
import { BRAND_NAME, FONT_SANS, LOGO_URL, PRIMARY_COLOR } from '../../brand/email-brand.mjs'

interface Props {
  preview?: string
  brandName?: string
  logoUrl?: string
  primaryColor?: string
  appUrl?: string
}

withDefaults(defineProps<Props>(), {
  preview: '',
  brandName: BRAND_NAME,
  logoUrl: LOGO_URL,
  primaryColor: PRIMARY_COLOR,
  appUrl: ''
})
</script>

<template>
  <EHtml lang="en">
    <EHead />
    <EPreview v-if="preview">
      {{ preview }}
    </EPreview>
    <EBody
      :style="{
        backgroundColor: '#ffffff',
        fontFamily: FONT_SANS
      }"
    >
      <EContainer
        :style="{
          maxWidth: '480px',
          margin: '0 auto',
          padding: '0 20px 40px'
        }"
      >
        <!-- Brand accent -->
        <EHr
          :style="{
            borderTop: `3px solid ${primaryColor}`,
            borderBottom: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            margin: '0 0 40px',
            width: '48px'
          }"
        />

        <!-- Logo / Brand -->
        <ESection :style="{ margin: '0 0 40px' }">
          <EImg
            v-if="logoUrl"
            :src="logoUrl"
            :alt="brandName"
            width="auto"
            height="28"
            :style="{ display: 'block' }"
          />
          <EText
            v-else
            :style="{
              fontSize: '15px',
              fontWeight: '600',
              color: '#0a0a0a',
              margin: '0',
              lineHeight: '1'
            }"
          >
            {{ brandName }}
          </EText>
        </ESection>

        <!-- Content -->
        <ESection>
          <slot />
        </ESection>

        <!-- Footer -->
        <ESection :style="{ margin: '48px 0 0' }">
          <EHr
            :style="{
              borderTop: '1px solid #e5e5e5',
              borderBottom: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              margin: '0 0 24px'
            }"
          />
          <EText
            :style="{
              fontSize: '12px',
              lineHeight: '16px',
              color: '#a3a3a3',
              margin: '0'
            }"
          >
            {{ brandName }}
          </EText>
        </ESection>
      </EContainer>
    </EBody>
  </EHtml>
</template>
