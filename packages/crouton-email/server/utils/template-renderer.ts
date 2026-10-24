import { createApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { convert } from 'html-to-text'

const DOCTYPE = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'

/** Remove Vue's SSR fragment markers and inspector attributes — none of it belongs in an email. */
function cleanup(markup: string): string {
  return markup
    .replace(/ data-v-inspector="[^"]*"/g, '')
    .replace(/<!--\[-->/g, '')
    .replace(/<!--]-->/g, '')
    .replace(/<template[^>]*>/g, '')
    .replace(/<\/template>/g, '')
}

/** Plain-text alternative: skip images and the hidden inbox-preview block. */
function htmlToText(html: string): string {
  return convert(html, {
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: '#__vue-email-preview', format: 'skip' },
    ],
  })
}

/**
 * Render an email template (a Vue SFC built from `../emails/primitives`) to HTML + text.
 *
 * In-house since #2224: Vue's own server renderer plus `html-to-text`, replacing
 * `vue-email`'s `useRender` (unmaintained, unpatchable advisory). Output is unchanged —
 * see `tests/render-templates.test.ts`.
 */
export async function renderEmailTemplate<T extends Record<string, unknown>>(
  component: Component,
  props: T
): Promise<{ html: string, text?: string }> {
  try {
    const app = createApp({ render: () => h(component) }, props)
    const markup = await renderToString(app)
    return {
      html: `${DOCTYPE}${cleanup(markup)}`,
      text: htmlToText(markup),
    }
  } catch (err) {
    console.error('[crouton-email] Failed to render template:', err)
    throw err
  }
}

/**
 * Get brand config from runtime config for templates
 */
export function getEmailBrandConfig(event?: any) {
  // In Nitro context, useRuntimeConfig can be called with event
  let resolvedEvent = event
  if (!resolvedEvent) { try { resolvedEvent = useEvent() } catch {} }
  const config = resolvedEvent ? useRuntimeConfig(resolvedEvent) : useRuntimeConfig()
  const publicConfig = (config.public as any)?.crouton?.email

  // Fall back to BETTER_AUTH_URL for appUrl — it must be set for auth to work,
  // so invitation emails always get an absolute URL even if brand.url is missing.
  const appUrl = publicConfig?.brand?.url
    || (config as any).auth?.baseUrl
    || process.env.BETTER_AUTH_URL
    || ''

  return {
    brandName: publicConfig?.brand?.name || 'My App',
    logoUrl: publicConfig?.brand?.logoUrl || '',
    primaryColor: publicConfig?.brand?.primaryColor || '#0F766E',
    appUrl
  }
}
