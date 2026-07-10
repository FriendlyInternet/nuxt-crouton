// Blueprint Theme Configuration (#1311)
// Cyanotype blue, white line-work, dimension rules, drafting annotations.

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'sky',
      neutral: 'slate'
    },

    button: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'blueprint': '',
          'blueprint-solid': '',
          'blueprint-outline': '',
          'blueprint-soft': '',
          'blueprint-ghost': '',
          'blueprint-link': ''
        }
      },
      compoundVariants: [
        { color: 'primary', variant: 'blueprint', class: 'bp-btn bp-btn--primary' },
        { color: 'neutral', variant: 'blueprint', class: 'bp-btn' },
        { color: 'error', variant: 'blueprint', class: 'bp-btn bp-btn--alert' },
        { variant: 'blueprint', class: 'bp-btn' },

        { color: 'primary', variant: 'blueprint-solid', class: 'bp-btn bp-btn--primary' },
        { color: 'neutral', variant: 'blueprint-solid', class: 'bp-btn' },
        { color: 'error', variant: 'blueprint-solid', class: 'bp-btn bp-btn--alert' },
        { variant: 'blueprint-solid', class: 'bp-btn' },

        { color: 'primary', variant: 'blueprint-outline', class: 'bp-outline bp-outline--primary' },
        { color: 'neutral', variant: 'blueprint-outline', class: 'bp-outline' },
        { color: 'error', variant: 'blueprint-outline', class: 'bp-outline bp-outline--alert' },
        { variant: 'blueprint-outline', class: 'bp-outline' },

        { color: 'primary', variant: 'blueprint-soft', class: 'bp-soft bp-soft--primary' },
        { color: 'neutral', variant: 'blueprint-soft', class: 'bp-soft' },
        { color: 'error', variant: 'blueprint-soft', class: 'bp-soft bp-soft--alert' },
        { variant: 'blueprint-soft', class: 'bp-soft' },

        { color: 'primary', variant: 'blueprint-ghost', class: 'bp-ghost bp-ghost--primary' },
        { color: 'neutral', variant: 'blueprint-ghost', class: 'bp-ghost' },
        { color: 'error', variant: 'blueprint-ghost', class: 'bp-ghost' },
        { variant: 'blueprint-ghost', class: 'bp-ghost' },

        { color: 'primary', variant: 'blueprint-link', class: 'bp-link bp-link--primary' },
        { color: 'neutral', variant: 'blueprint-link', class: 'bp-link' },
        { color: 'error', variant: 'blueprint-link', class: 'bp-link' },
        { variant: 'blueprint-link', class: 'bp-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          blueprint: {
            root: 'bp-input',
            base: 'bp-input-base'
          }
        }
      }
    },

    card: {
      slots: {
        root: subtractThemeDefaults,
        header: subtractThemeDefaults,
        body: subtractThemeDefaults,
        footer: subtractThemeDefaults
      },
      variants: {
        variant: {
          blueprint: {
            root: 'bp-card',
            header: 'bp-card-header',
            body: 'bp-card-body',
            footer: 'bp-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          blueprint: {
            border: 'bp-separator'
          }
        }
      }
    },

    badge: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          blueprint: 'bp-badge'
        }
      }
    }
  }
})
