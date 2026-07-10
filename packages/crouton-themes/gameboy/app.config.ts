// Game Boy LCD Theme Configuration (#1310)
// The original DMG screen: FOUR shades of olive green, and nothing else.
// Semantic colors (error/warning) map onto the shades via inversion and
// pattern, never hue — the constraint IS the theme.

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'stone'
    },

    button: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'gameboy': '',
          'gameboy-solid': '',
          'gameboy-outline': '',
          'gameboy-soft': '',
          'gameboy-ghost': '',
          'gameboy-link': ''
        }
      },
      compoundVariants: [
        // === GAMEBOY (chunky sprite buttons) ===
        { color: 'primary', variant: 'gameboy', class: 'gb-btn gb-btn--dark' },
        { color: 'neutral', variant: 'gameboy', class: 'gb-btn' },
        { color: 'error', variant: 'gameboy', class: 'gb-btn gb-btn--alert' },
        { variant: 'gameboy', class: 'gb-btn' },

        // === GAMEBOY-SOLID (alias) ===
        { color: 'primary', variant: 'gameboy-solid', class: 'gb-btn gb-btn--dark' },
        { color: 'neutral', variant: 'gameboy-solid', class: 'gb-btn' },
        { color: 'error', variant: 'gameboy-solid', class: 'gb-btn gb-btn--alert' },
        { variant: 'gameboy-solid', class: 'gb-btn' },

        // === GAMEBOY-OUTLINE ===
        { color: 'primary', variant: 'gameboy-outline', class: 'gb-outline' },
        { color: 'neutral', variant: 'gameboy-outline', class: 'gb-outline' },
        { color: 'error', variant: 'gameboy-outline', class: 'gb-outline gb-outline--alert' },
        { variant: 'gameboy-outline', class: 'gb-outline' },

        // === GAMEBOY-SOFT (mid-shade fill) ===
        { color: 'primary', variant: 'gameboy-soft', class: 'gb-soft' },
        { color: 'neutral', variant: 'gameboy-soft', class: 'gb-soft' },
        { color: 'error', variant: 'gameboy-soft', class: 'gb-soft gb-soft--alert' },
        { variant: 'gameboy-soft', class: 'gb-soft' },

        // === GAMEBOY-GHOST (cursor arrow) ===
        { color: 'primary', variant: 'gameboy-ghost', class: 'gb-ghost' },
        { color: 'neutral', variant: 'gameboy-ghost', class: 'gb-ghost' },
        { color: 'error', variant: 'gameboy-ghost', class: 'gb-ghost' },
        { variant: 'gameboy-ghost', class: 'gb-ghost' },

        // === GAMEBOY-LINK ===
        { color: 'primary', variant: 'gameboy-link', class: 'gb-link' },
        { color: 'neutral', variant: 'gameboy-link', class: 'gb-link' },
        { color: 'error', variant: 'gameboy-link', class: 'gb-link' },
        { variant: 'gameboy-link', class: 'gb-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          gameboy: {
            root: 'gb-input',
            base: 'gb-input-base'
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
          gameboy: 'gb-input-base'
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
          gameboy: {
            root: 'gb-input',
            base: 'gb-input-base'
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
          gameboy: {
            root: 'gb-card',
            header: 'gb-card-header',
            body: 'gb-card-body',
            footer: 'gb-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          gameboy: {
            border: 'gb-separator'
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
          gameboy: 'gb-badge'
        }
      }
    }
  }
})
