/**
 * #2224 — the transactional templates must render IDENTICALLY after the renderer swap.
 *
 * The snapshots were captured with vue-email 0.8 (the unmaintained library with the
 * unpatchable advisory) and are the contract the in-house primitives have to meet: same
 * HTML, same plain-text fallback, for every template at both its defaults and with every
 * admin override set. A diff here is a visible change in someone's inbox.
 */
import { describe, it, expect } from 'vitest'
import { renderEmailTemplate } from '../server/utils/template-renderer'
import Verification from '../server/emails/Verification.vue'
import VerificationLink from '../server/emails/VerificationLink.vue'
import MagicLink from '../server/emails/MagicLink.vue'
import PasswordReset from '../server/emails/PasswordReset.vue'
import TeamInvite from '../server/emails/TeamInvite.vue'
import Welcome from '../server/emails/Welcome.vue'

const brand = {
  brandName: 'Crouton Test',
  logoUrl: '',
  primaryColor: '#0F766E',
  appUrl: 'https://app.example.test',
}
const branded = { ...brand, logoUrl: 'https://app.example.test/logo.png' }
const overrides = {
  greeting: 'Hallo {{name}}',
  body: 'Custom body for {{brandName}} with {{teamName}}{{inviterName}}',
  buttonText: 'Go {{teamName}}',
  footer: 'Custom footer.',
}

const cases: Array<[string, any, Record<string, unknown>]> = [
  ['Verification (defaults)', Verification, { code: '123456', name: 'Ada', expiryMinutes: 10, ...brand }],
  ['Verification (overrides)', Verification, { code: '123456', name: 'Ada', expiryMinutes: 5, ...branded, ...overrides }],
  ['VerificationLink (defaults)', VerificationLink, { link: 'https://app.example.test/verify?t=abc', name: 'Ada', expiryMinutes: 10, ...brand }],
  ['VerificationLink (overrides)', VerificationLink, { link: 'https://app.example.test/verify?t=abc', expiryMinutes: 30, ...branded, ...overrides }],
  ['MagicLink (defaults)', MagicLink, { link: 'https://app.example.test/magic?t=abc', name: 'Ada', expiryMinutes: 10, ...brand }],
  ['MagicLink (overrides)', MagicLink, { link: 'https://app.example.test/magic?t=abc', expiryMinutes: 15, ...branded, ...overrides }],
  ['PasswordReset (defaults)', PasswordReset, { link: 'https://app.example.test/reset?t=abc', name: 'Ada', expiryMinutes: 10, ...brand }],
  ['PasswordReset (overrides)', PasswordReset, { link: 'https://app.example.test/reset?t=abc', expiryMinutes: 60, ...branded, ...overrides }],
  ['TeamInvite (member)', TeamInvite, { link: 'https://app.example.test/invite?t=abc', inviterName: 'Grace', teamName: 'Vélo', ...brand }],
  ['TeamInvite (admin, overrides)', TeamInvite, { link: 'https://app.example.test/invite?t=abc', inviterName: 'Grace', teamName: 'Vélo', role: 'admin', ...branded, ...overrides }],
  ['Welcome (defaults)', Welcome, { name: 'Ada', ...brand }],
  ['Welcome (link + overrides)', Welcome, { name: 'Ada', getStartedLink: 'https://app.example.test/start', ...branded, ...overrides }],
]

describe('email templates render byte-for-byte as before the renderer swap', () => {
  for (const [label, component, props] of cases) {
    it(label, async () => {
      const { html, text } = await renderEmailTemplate(component, props)
      expect(html).toMatchSnapshot('html')
      expect(text).toMatchSnapshot('text')
      // Sanity beyond the snapshot: a full document with the brand and no Vue SSR debris.
      expect(html.startsWith('<!DOCTYPE html')).toBe(true)
      expect(html).toContain('Crouton Test')
      expect(html).not.toMatch(/<!--\[-->|<!--]-->|<template/)
      expect(text).toContain('Crouton Test')
    })
  }
})
