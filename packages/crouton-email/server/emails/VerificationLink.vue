<script setup lang="ts">
import { EText, EButton, ESection } from './primitives'
import BaseLayout from './BaseLayout.vue'
import type { BaseEmailTemplateProps, ContentOverrideProps } from './template-props'

interface Props extends BaseEmailTemplateProps, ContentOverrideProps {
  link: string
  name?: string
  expiryMinutes: number
}

const props = withDefaults(defineProps<Props>(), {
  name: '',
  expiryMinutes: 10,
  preview: 'Verify your email address',
  brandName: 'My App',
  logoUrl: '',
  primaryColor: '#0F766E',
  appUrl: '',
  greeting: '',
  body: '',
  buttonText: '',
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
  : 'Please verify your email address by clicking the link below.'
const resolvedButtonText = props.buttonText || 'Verify email'
const resolvedFooter = props.footer
  ? interpolate(props.footer, vars)
  : `This link expires in ${props.expiryMinutes} minutes. If you didn't create an account, you can safely ignore this email.`
</script>

<template>
  <BaseLayout
    :preview="preview"
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

    <ESection :style="{ margin: '0 0 24px' }">
      <EButton
        :href="link"
        :style="{
          backgroundColor: primaryColor,
          borderRadius: '6px',
          color: '#ffffff',
          fontSize: '14px',
          fontWeight: '600',
          textDecoration: 'none',
          textAlign: 'center',
          display: 'inline-block',
          padding: '12px 24px'
        }"
      >
        {{ resolvedButtonText }}
      </EButton>
    </ESection>

    <EText
      :style="{
        fontSize: '14px',
        lineHeight: '24px',
        color: '#0a0a0a',
        margin: '0 0 24px'
      }"
    >
      Or copy this URL into your browser:<br>
      <a
        :href="link"
        :style="{
          color: primaryColor,
          textDecoration: 'none',
          wordBreak: 'break-all'
        }"
      >{{ link }}</a>
    </EText>

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
