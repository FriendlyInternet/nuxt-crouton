<script setup lang="ts">
import { EText, EButton, ESection } from './primitives'
import BaseLayout from './BaseLayout.vue'
import type { BaseEmailTemplateProps, ContentOverrideProps } from './template-props'

interface Props extends BaseEmailTemplateProps, ContentOverrideProps {
  name: string
  getStartedLink?: string
}

const props = withDefaults(defineProps<Props>(), {
  getStartedLink: '',
  preview: '',
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
  brandName: props.brandName
}

const previewText = props.preview || `Welcome to ${props.brandName}!`
const resolvedGreeting = props.greeting
  ? interpolate(props.greeting, vars)
  : `Welcome aboard, ${props.name}`
const resolvedBody = props.body
  ? interpolate(props.body, vars)
  : ''
const resolvedButtonText = props.buttonText || 'Get Started'
const resolvedFooter = props.footer
  ? interpolate(props.footer, vars)
  : "Questions? Just reply to this email — we're here to help."
</script>

<template>
  <BaseLayout
    :preview="previewText"
    :brand-name="brandName"
    :logo-url="logoUrl"
    :primary-color="primaryColor"
    :app-url="appUrl"
  >
    <EText
      :style="{
        fontSize: '20px',
        fontWeight: '600',
        color: '#18181b',
        margin: '0 0 8px',
        lineHeight: '28px'
      }"
    >
      {{ resolvedGreeting }}
    </EText>

    <EText
      v-if="resolvedBody"
      :style="{
        fontSize: '15px',
        lineHeight: '24px',
        color: '#52525b',
        margin: '0 0 28px'
      }"
    >
      {{ resolvedBody }}
    </EText>
    <template v-else>
      <EText
        :style="{
          fontSize: '15px',
          lineHeight: '24px',
          color: '#52525b',
          margin: '0 0 28px'
        }"
      >
        Your account is ready. Here's how to get started:
      </EText>

      <ESection
        :style="{
          backgroundColor: '#fafafa',
          borderRadius: '8px',
          padding: '24px',
          margin: '0 0 28px'
        }"
      >
        <EText
          :style="{
            fontSize: '14px',
            lineHeight: '24px',
            color: '#52525b',
            margin: '0'
          }"
        >
          1. Complete your profile<br>
          2. Explore the dashboard<br>
          3. Invite your team members
        </EText>
      </ESection>
    </template>

    <ESection
      v-if="getStartedLink"
      :style="{ margin: '0 0 28px' }"
    >
      <EButton
        :href="getStartedLink"
        :style="{
          backgroundColor: primaryColor,
          borderRadius: '6px',
          color: '#ffffff',
          fontSize: '15px',
          fontWeight: '600',
          textDecoration: 'none',
          textAlign: 'center',
          display: 'inline-block',
          padding: '12px 32px'
        }"
      >
        {{ resolvedButtonText }}
      </EButton>
    </ESection>

    <EText
      :style="{
        fontSize: '13px',
        lineHeight: '20px',
        color: '#a1a1aa',
        margin: '0'
      }"
    >
      {{ resolvedFooter }}
    </EText>
  </BaseLayout>
</template>
