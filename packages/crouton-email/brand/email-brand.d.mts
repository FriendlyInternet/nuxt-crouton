/**
 * Type declarations for the dependency-free brand SSOT (`email-brand.mjs`).
 * Kept hand-written so the runtime stays plain ESM (importable by the no-build
 * digest render scripts) while the Vue Email SFCs still typecheck.
 */

export declare const BRAND_NAME: string
export declare const PRIMARY_COLOR: string
export declare const PRIMARY_COLOR_DARK: string
export declare const BRAND_URL: string
export declare const LOGO_URL: string
export declare const FONT_SANS: string

export interface EmailBrand {
  name: string
  primaryColor: string
  primaryColorDark: string
  url: string
  logoUrl: string
  fontSans: string
}

export declare const brand: EmailBrand

declare const _default: EmailBrand
export default _default
