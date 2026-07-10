// E-ink Theme Configuration (#1311)
// Pure greyscale, zero motion, newspaper typography. A reading mode.

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      neutral: 'neutral'
    },

    button: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'eink': '',
          'eink-solid': '',
          'eink-outline': '',
          'eink-soft': '',
          'eink-ghost': '',
          'eink-link': ''
        }
      },
      compoundVariants: [
        { color: 'primary', variant: 'eink', class: 'eink-btn eink-btn--primary' },
        { color: 'neutral', variant: 'eink', class: 'eink-btn' },
        { color: 'error', variant: 'eink', class: 'eink-btn eink-btn--alert' },
        { variant: 'eink', class: 'eink-btn' },

        { color: 'primary', variant: 'eink-solid', class: 'eink-btn eink-btn--primary' },
        { color: 'neutral', variant: 'eink-solid', class: 'eink-btn' },
        { color: 'error', variant: 'eink-solid', class: 'eink-btn eink-btn--alert' },
        { variant: 'eink-solid', class: 'eink-btn' },

        { color: 'primary', variant: 'eink-outline', class: 'eink-outline eink-outline--primary' },
        { color: 'neutral', variant: 'eink-outline', class: 'eink-outline' },
        { color: 'error', variant: 'eink-outline', class: 'eink-outline eink-outline--alert' },
        { variant: 'eink-outline', class: 'eink-outline' },

        { color: 'primary', variant: 'eink-soft', class: 'eink-soft eink-soft--primary' },
        { color: 'neutral', variant: 'eink-soft', class: 'eink-soft' },
        { color: 'error', variant: 'eink-soft', class: 'eink-soft eink-soft--alert' },
        { variant: 'eink-soft', class: 'eink-soft' },

        { color: 'primary', variant: 'eink-ghost', class: 'eink-ghost eink-ghost--primary' },
        { color: 'neutral', variant: 'eink-ghost', class: 'eink-ghost' },
        { color: 'error', variant: 'eink-ghost', class: 'eink-ghost' },
        { variant: 'eink-ghost', class: 'eink-ghost' },

        { color: 'primary', variant: 'eink-link', class: 'eink-link eink-link--primary' },
        { color: 'neutral', variant: 'eink-link', class: 'eink-link' },
        { color: 'error', variant: 'eink-link', class: 'eink-link' },
        { variant: 'eink-link', class: 'eink-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          eink: {
            root: 'eink-input',
            base: 'eink-input-base'
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
          eink: {
            root: 'eink-card',
            header: 'eink-card-header',
            body: 'eink-card-body',
            footer: 'eink-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          eink: {
            border: 'eink-separator'
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
          eink: 'eink-badge'
        }
      }
    }
  }
})
