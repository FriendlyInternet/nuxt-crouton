<script setup lang="ts">
import { EText, ESection } from './primitives'
import BaseLayout from './BaseLayout.vue'
import type { BaseEmailTemplateProps, BasicContentOverrideProps } from './template-props'

interface Props extends BaseEmailTemplateProps, BasicContentOverrideProps {
  code: string
  name?: string
  expiryMinutes: number
}

const props = withDefaults(defineProps<Props>(), {
  name: '',
  expiryMinutes: 10,
  preview: '',
  brandName: 'My App',
  logoUrl: '',
  primaryColor: '#0F766E',
  appUrl: '',
  greeting: '',
  body: '',
  footer: ''
})

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

const vars = {
  name: props.name,
  brandName: props.brandName,
  minutes: String(props.expiryMinutes)
}

const resolvedGreeting = props.greeting
  ? interpolate(props.greeting, vars)
  : `Hi${props.name ? ` ${props.name}` : ''}`
const resolvedBody = props.body
  ? interpolate(props.body, vars)
  : 'Your verification code is below.'
const resolvedFooter = props.footer
  ? interpolate(props.footer, vars)
  : `This code expires in ${props.expiryMinutes} minutes. If you didn't request this, you can safely ignore this email.`
</script>

<template>
  <BaseLayout
    :preview="preview || `Your verification code is ${code}`"
    :brand-name="brandName"
    :logo-url="logoUrl"
    :primary-color="primaryColor"
    :app-url="appUrl"
  >
    <EText
      :style="{
        fontSize: '14px',
        lineHeight: '24px',
        color: '#0a0a0a',
        margin: '0 0 24px'
      }"
    >
      {{ resolvedGreeting }},<br><br>
      {{ resolvedBody }}
    </EText>

    <ESection
      :style="{
        textAlign: 'center',
        margin: '0 0 24px'
      }"
    >
      <EText
        :style="{
          fontSize: '32px',
          fontWeight: '700',
          letterSpacing: '4px',
          color: '#0a0a0a',
          margin: '16px 0',
          fontFamily: '\'SF Mono\', \'Fira Code\', \'Fira Mono\', \'Roboto Mono\', \'Courier New\', monospace'
        }"
      >
        {{ code }}
      </EText>
    </ESection>

    <EText
      :style="{
        fontSize: '12px',
        lineHeight: '20px',
        color: '#a3a3a3',
        margin: '0'
      }"
    >
      {{ resolvedFooter }}
    </EText>
  </BaseLayout>
</template>
