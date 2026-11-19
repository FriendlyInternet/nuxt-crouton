/**
 * Nitro virtual module registered by the crouton-pages inline module in
 * nuxt.config.ts (#4175): the first segment of every top-level page the app
 * owns (read from the resolved page tree at build time).
 */
declare module '#crouton-pages/app-segments' {
  export const appPageSegments: string[]
}
