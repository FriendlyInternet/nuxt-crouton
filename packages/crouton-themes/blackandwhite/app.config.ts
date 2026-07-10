import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    theme: {
      defaultVariants: {
        size: 'sm'
      }
    },
    colors: {
      primary: 'neutral',
      neutral: 'neutral'
    },
    container: {
      base: 'w-full max-w-full mx-auto px-4 sm:px-6 lg:px-8'
    },
    select: {
      slots: {
        content: 'min-w-fit'
      },
      defaultVariants: {
        variant: 'subtle'
      }
    },
    button: {
      // NAMED bw-* variants + a defaultVariants pointer (#1304, was an override
      // of the standard solid/outline/... slots). Same single-theme contract —
      // a plain <UButton> in an app extending this layer resolves to bw-solid —
      // but the standard variants stay untouched, so in a multi-theme app (the
      // playground) this layer no longer restyles the other themes' buttons,
      // and an explicit variant="outline" is the author's literal choice.
      // The shared marker-gated replacer (#1304) strips the conflicting
      // defaults (color/elevation/motion/underline) when a bw-* marker is
      // present, so the CSS needs no !important; Nuxt UI's rounding, sizing
      // and focus ring are kept.
      slots: {
        base: subtractThemeDefaults
      },
      defaultVariants: {
        variant: 'bw-solid'
      },
      variants: {
        variant: {
          'bw-solid': 'bw-solid',
          'bw-outline': 'bw-outline',
          'bw-soft': 'bw-soft',
          'bw-ghost': 'bw-ghost',
          'bw-link': 'bw-link'
        }
      }
    },
    dashboardPanel: {
      slots: {
        body: 'p-4'
      }
    },
    navigationMenu: {
      props: {
        color: 'primary',
        variant: 'pill',
        orientation: 'vertical',
        highlight: false,
        highlightColor: 'primary',
        collapsed: false
      },
      slots: {
        root: 'w-full'
      }
    },
    card: {
      defaultVariants: {
        variant: 'outline'
      }
    },
    input: {
      variants: {
        variant: {}
      },
      defaultVariants: {
        variant: 'subtle'
      }
    },
    alert: {
      defaultVariants: {
        variant: 'subtle'
      }
    },
    textarea: {
      defaultVariants: {
        variant: 'subtle'
      }
    }
  }
})
