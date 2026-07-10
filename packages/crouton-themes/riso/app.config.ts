// Risograph Theme Configuration (#1311)
// Grainy 2-color overprint: fluoro pink + teal, misregistration offsets, paper.

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'pink',
      neutral: 'stone'
    },

    button: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'riso': '',
          'riso-solid': '',
          'riso-outline': '',
          'riso-soft': '',
          'riso-ghost': '',
          'riso-link': ''
        }
      },
      compoundVariants: [
        { color: 'primary', variant: 'riso', class: 'riso-btn riso-btn--primary' },
        { color: 'neutral', variant: 'riso', class: 'riso-btn' },
        { color: 'error', variant: 'riso', class: 'riso-btn riso-btn--alert' },
        { variant: 'riso', class: 'riso-btn' },

        { color: 'primary', variant: 'riso-solid', class: 'riso-btn riso-btn--primary' },
        { color: 'neutral', variant: 'riso-solid', class: 'riso-btn' },
        { color: 'error', variant: 'riso-solid', class: 'riso-btn riso-btn--alert' },
        { variant: 'riso-solid', class: 'riso-btn' },

        { color: 'primary', variant: 'riso-outline', class: 'riso-outline riso-outline--primary' },
        { color: 'neutral', variant: 'riso-outline', class: 'riso-outline' },
        { color: 'error', variant: 'riso-outline', class: 'riso-outline riso-outline--alert' },
        { variant: 'riso-outline', class: 'riso-outline' },

        { color: 'primary', variant: 'riso-soft', class: 'riso-soft riso-soft--primary' },
        { color: 'neutral', variant: 'riso-soft', class: 'riso-soft' },
        { color: 'error', variant: 'riso-soft', class: 'riso-soft riso-soft--alert' },
        { variant: 'riso-soft', class: 'riso-soft' },

        { color: 'primary', variant: 'riso-ghost', class: 'riso-ghost riso-ghost--primary' },
        { color: 'neutral', variant: 'riso-ghost', class: 'riso-ghost' },
        { color: 'error', variant: 'riso-ghost', class: 'riso-ghost' },
        { variant: 'riso-ghost', class: 'riso-ghost' },

        { color: 'primary', variant: 'riso-link', class: 'riso-link riso-link--primary' },
        { color: 'neutral', variant: 'riso-link', class: 'riso-link' },
        { color: 'error', variant: 'riso-link', class: 'riso-link' },
        { variant: 'riso-link', class: 'riso-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          riso: {
            root: 'riso-input',
            base: 'riso-input-base'
          }
        }
      }
    },

    select: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          riso: 'riso-input-base'
        }
      }
    },

    textarea: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          riso: {
            root: 'riso-input',
            base: 'riso-input-base'
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
          riso: {
            root: 'riso-card',
            header: 'riso-card-header',
            body: 'riso-card-body',
            footer: 'riso-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          riso: {
            border: 'riso-separator'
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
          riso: 'riso-badge'
        }
      }
    }
  }
})
