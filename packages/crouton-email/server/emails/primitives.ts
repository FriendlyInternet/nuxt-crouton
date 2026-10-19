/**
 * The email building blocks the templates are written with (#2224).
 *
 * These used to come from `vue-email`, which is unmaintained and carries an unpatchable
 * advisory (`module-from-string`) plus a long DOMPurify tail. We only ever used ten of its
 * components, all thin wrappers around the table-based HTML that email clients need — so they
 * live here now, emitting the SAME markup (including the `data-id` hooks and the Outlook
 * `mso` button hack), so existing templates render byte-for-byte as before. Contract:
 * `tests/render-templates.test.ts` (snapshots captured with vue-email before the swap).
 *
 * Style handling: none of these declare a `style` prop, so a template's `:style="{…}"`
 * falls through as an attribute and Vue MERGES it with the base style here — exactly how
 * vue-email behaved. Keep it that way; declaring `style` as a prop would stop the merge.
 */
import { computed, defineComponent, h } from 'vue'

const PREVIEW_MAX_LENGTH = 150

/** Pixels → points, for Outlook's `mso-text-raise`. */
function pxToPt(px: string | number): number | null {
  return Number.isNaN(Number(px)) ? null : Number.parseInt(`${px}`, 10) * 3 / 4
}

export const EHtml = defineComponent({
  name: 'EHtml',
  props: {
    lang: { type: String, default: 'en' },
    dir: { type: String, default: 'ltr' },
  },
  setup(props, { slots }) {
    return () => h('html', { id: '__vue-email', lang: props.lang, dir: props.dir }, slots.default?.())
  },
})

export const EHead = defineComponent({
  name: 'EHead',
  setup(_, { slots }) {
    return () => h('head', [
      h('meta', { httpEquiv: 'Content-Type', content: 'text/html; charset=UTF-8' }),
      slots.default?.(),
    ])
  },
})

/** Inbox preview line: hidden text padded with invisible characters so clients don't pull body text in. */
export const EPreview = defineComponent({
  name: 'EPreview',
  setup(_, { slots }) {
    const text = computed(() => {
      if (slots.default === undefined) return ''
      const children = slots.default()[0]?.children
      const raw = Array.isArray(children) ? children.join('') : children
      return typeof raw === 'string' ? raw.substring(0, PREVIEW_MAX_LENGTH) : ''
    })
    function renderWhiteSpace(value: string): string | null {
      if (value.length >= PREVIEW_MAX_LENGTH) return null
      const whiteSpaceCodes = '\xA0‌​‍‎‏﻿'
      return whiteSpaceCodes.repeat(PREVIEW_MAX_LENGTH - value.length)
    }
    return () => h(
      'div',
      {
        id: '__vue-email-preview',
        style: 'display: none; overflow: hidden; line-height: 1px; opacity: 0; max-height: 0; max-width: 0',
      },
      [text.value, h('div', [renderWhiteSpace(text.value)])],
    )
  },
})

export const EBody = defineComponent({
  name: 'EBody',
  setup(_, { slots }) {
    return () => h('body', { 'data-id': '__vue-email-body' }, slots.default?.())
  },
})

export const EContainer = defineComponent({
  name: 'EContainer',
  setup(_, { slots }) {
    return () => h(
      'table',
      {
        'align': 'center',
        'width': '100%',
        'data-id': '__vue-email-container',
        'role': 'presentation',
        'cellspacing': '0',
        'cellpadding': '0',
        'border': '0',
        'style': 'max-width: 37.5em',
      },
      [h('tbody', [h('tr', { style: 'width: 100%' }, [h('td', {}, slots.default?.())])])],
    )
  },
})

export const ESection = defineComponent({
  name: 'ESection',
  setup(_, { slots }) {
    return () => h(
      'table',
      {
        'align': 'center',
        'width': '100%',
        'data-id': '__vue-email-section',
        'border': '0',
        'cellPadding': '0',
        'cellSpacing': '0',
        'role': 'presentation',
      },
      [h('tbody', [h('tr', [h('td', slots.default?.())])])],
    )
  },
})

export const EText = defineComponent({
  name: 'EText',
  setup(_, { slots }) {
    return () => h(
      'p',
      { 'data-id': '__vue-email-text', 'style': 'font-size: 14px; line-height: 24px; margin: 16px 0;' },
      slots.default?.(),
    )
  },
})

export const EHr = defineComponent({
  name: 'EHr',
  setup() {
    return () => h('hr', {
      'data-id': '__vue-email-hr',
      'style': 'width: 100%; border: none; border-top: 1px solid #eaeaea;',
    })
  },
})

export const EImg = defineComponent({
  name: 'EImg',
  props: { src: { type: String, required: true } },
  setup(props) {
    return () => h('img', {
      'data-id': '__vue-email-img',
      'style': 'display: block; outline: none; border: none; text-decoration: none',
      'src': props.src,
    })
  },
})

/** A link styled as a button, with the conditional-comment padding hack Outlook needs. */
export const EButton = defineComponent({
  name: 'EButton',
  props: {
    px: { type: [String, Number] },
    py: { type: [String, Number], default: 0 },
    target: { type: String, default: '_blank' },
    href: String,
    style: Object,
  },
  setup(props, { slots }) {
    const px = props.px || 0
    const py = props.py || 0
    const textRaise = pxToPt(Number.parseInt(py.toString()) * 2)
    const buttonStyle: Record<string, unknown> = {
      lineHeight: '100%',
      textDecoration: 'none',
      display: 'inline-block',
      maxWidth: '100%',
      ...(props.style ?? {}),
    }
    if (py || px) buttonStyle.padding = `${py}px ${px}px`
    const buttonTextStyle = computed(() => ({
      maxWidth: '100%',
      display: 'inline-block',
      lineHeight: '120%',
      textDecoration: 'none',
      textTransform: 'none',
      msoPaddingAlt: '0px',
      msoTextRaise: pxToPt(py.toString()),
    }))
    const firstSpan = `<!--[if mso]><i style="letter-spacing: ${px}px;mso-font-width:-100%;mso-text-raise:${textRaise}" hidden>&nbsp;</i><![endif]-->`
    const secondSpan = `<!--[if mso]><i style="letter-spacing: ${px}px;mso-font-width:-100%" hidden>&nbsp;</i><![endif]-->`
    return () => h(
      'a',
      { 'data-id': '__vue-email-button', 'style': buttonStyle, 'href': props.href, 'target': props.target },
      [
        h('span', { innerHTML: firstSpan }),
        h('span', { style: buttonTextStyle.value }, slots.default?.()),
        h('span', { innerHTML: secondSpan }),
      ],
    )
  },
})
