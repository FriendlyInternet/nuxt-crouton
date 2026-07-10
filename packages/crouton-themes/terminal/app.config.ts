// Terminal / CRT Theme Configuration (#1308)
// Green phosphor on near-black, monospace, glow, inverse-video states.
// Built on replacers per the #1305 spike verdict (NOT unstyled-native).

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc'
    },

    button: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'terminal': '',
          'terminal-solid': '',
          'terminal-outline': '',
          'terminal-soft': '',
          'terminal-ghost': '',
          'terminal-link': ''
        }
      },
      compoundVariants: [
        // === TERMINAL (inverse-video primary, bracketed others) ===
        { color: 'primary', variant: 'terminal', class: 'term-btn term-btn--inverse' },
        { color: 'neutral', variant: 'terminal', class: 'term-btn' },
        { color: 'error', variant: 'terminal', class: 'term-btn term-btn--amber' },
        { variant: 'terminal', class: 'term-btn' },

        // === TERMINAL-SOLID (alias) ===
        { color: 'primary', variant: 'terminal-solid', class: 'term-btn term-btn--inverse' },
        { color: 'neutral', variant: 'terminal-solid', class: 'term-btn' },
        { color: 'error', variant: 'terminal-solid', class: 'term-btn term-btn--amber' },
        { variant: 'terminal-solid', class: 'term-btn' },

        // === TERMINAL-OUTLINE (double-frame) ===
        { color: 'primary', variant: 'terminal-outline', class: 'term-outline' },
        { color: 'neutral', variant: 'terminal-outline', class: 'term-outline' },
        { color: 'error', variant: 'terminal-outline', class: 'term-outline term-outline--amber' },
        { variant: 'terminal-outline', class: 'term-outline' },

        // === TERMINAL-SOFT (dim field) ===
        { color: 'primary', variant: 'terminal-soft', class: 'term-soft' },
        { color: 'neutral', variant: 'terminal-soft', class: 'term-soft' },
        { color: 'error', variant: 'terminal-soft', class: 'term-soft term-soft--amber' },
        { variant: 'terminal-soft', class: 'term-soft' },

        // === TERMINAL-GHOST (bare prompt) ===
        { color: 'primary', variant: 'terminal-ghost', class: 'term-ghost' },
        { color: 'neutral', variant: 'terminal-ghost', class: 'term-ghost' },
        { color: 'error', variant: 'terminal-ghost', class: 'term-ghost term-ghost--amber' },
        { variant: 'terminal-ghost', class: 'term-ghost' },

        // === TERMINAL-LINK (underscore cursor) ===
        { color: 'primary', variant: 'terminal-link', class: 'term-link' },
        { color: 'neutral', variant: 'terminal-link', class: 'term-link' },
        { color: 'error', variant: 'terminal-link', class: 'term-link term-link--amber' },
        { variant: 'terminal-link', class: 'term-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          terminal: {
            root: 'term-input',
            base: 'term-input-base'
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
          terminal: 'term-input-base'
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
          terminal: {
            root: 'term-input',
            base: 'term-input-base'
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
          terminal: {
            root: 'term-card',
            header: 'term-card-header',
            body: 'term-card-body',
            footer: 'term-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          terminal: {
            border: 'term-separator'
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
          terminal: 'term-badge'
        }
      }
    }
  }
})
