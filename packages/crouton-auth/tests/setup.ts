import { vi } from 'vitest'
import en from '../i18n/locales/en.json'
import sharedEn from '../../crouton-i18n/locales/en.json'

// useT() is auto-imported in the app; composables now use it for user-facing
// text (#2285). Resolve keys from the real English locales ({x} interpolation).
vi.stubGlobal('useT', () => ({
  t: (key: string, params: Record<string, unknown> = {}) => {
    const lookup = (src: unknown) => key.split('.').reduce<any>((node, part) => node?.[part], src)
    const msg = lookup(en) ?? lookup(sharedEn)
    return typeof msg === 'string' ? msg.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : key
  }
}))

// Mock window object for browser APIs
Object.defineProperty(globalThis, 'window', {
  value: {
    location: {
      origin: 'http://localhost:3000',
      href: 'http://localhost:3000'
    }
  },
  writable: true
})

// Mock PublicKeyCredential for WebAuthn tests
const MockPublicKeyCredential = {
  isConditionalMediationAvailable: vi.fn().mockImplementation(async () => true)
}

Object.defineProperty(globalThis, 'PublicKeyCredential', {
  value: MockPublicKeyCredential,
  writable: true,
  configurable: true
})

// Mock navigator.credentials for WebAuthn tests
Object.defineProperty(globalThis, 'navigator', {
  value: {
    credentials: {
      create: vi.fn(),
      get: vi.fn()
    }
  },
  writable: true
})

// Mock import.meta.server for SSR checks
Object.defineProperty(import.meta, 'server', {
  value: false,
  writable: true,
  configurable: true
})
