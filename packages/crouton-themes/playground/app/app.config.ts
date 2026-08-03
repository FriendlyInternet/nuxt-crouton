// The playground extends EVERY theme layer, and blackandwhite's layer sets
// defaultVariants (variant bw-solid, size sm) for its single-theme apps. In a
// multi-theme app the pre-swap baseline must be Nuxt UI's true defaults — this
// app-level config outranks all layers and pins them; the runtime switcher
// then swaps defaultVariants per theme (see themes/configs/themeConfigs.ts).
export default defineAppConfig({
  ui: {
    theme: {
      defaultVariants: {
        size: 'md'
      }
    },
    colors: {
      primary: 'emerald',
      neutral: 'slate'
    },
    button: { defaultVariants: { variant: 'solid' } },
    input: { defaultVariants: { variant: 'outline' } },
    card: { defaultVariants: { variant: 'outline' } },
    badge: { defaultVariants: { variant: 'solid' } },
    alert: { defaultVariants: { variant: 'solid' } },
    textarea: { defaultVariants: { variant: 'outline' } },
    select: { defaultVariants: { variant: 'outline' } }
  }
})
