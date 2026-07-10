// Early-MTV Theme Configuration (#1346)
// 1981: day-glo color blocking, hard shadows in a CLASHING neon, a degree of
// tilt, stickers everywhere. Text stays ink-on-light (the KO readability rule).

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'fuchsia',
      neutral: 'zinc'
    },

    button: {
      // Subtractive base via the shared marker-gated replacer (#1304).
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'mtv': '',
          'mtv-solid': '',
          'mtv-outline': '',
          'mtv-soft': '',
          'mtv-ghost': '',
          'mtv-link': ''
        }
      },
      compoundVariants: [
        // === MTV (day-glo slabs, clashing shadows) ===
        { color: 'primary', variant: 'mtv', class: 'mtv-btn mtv-btn--pink' },
        { color: 'neutral', variant: 'mtv', class: 'mtv-btn mtv-btn--ink' },
        { color: 'error', variant: 'mtv', class: 'mtv-btn mtv-btn--cyan' },
        { variant: 'mtv', class: 'mtv-btn' },

        // === MTV-SOLID (alias of base) ===
        { color: 'primary', variant: 'mtv-solid', class: 'mtv-btn mtv-btn--pink' },
        { color: 'neutral', variant: 'mtv-solid', class: 'mtv-btn mtv-btn--ink' },
        { color: 'error', variant: 'mtv-solid', class: 'mtv-btn mtv-btn--cyan' },
        { variant: 'mtv-solid', class: 'mtv-btn' },

        // === MTV-OUTLINE ===
        { color: 'primary', variant: 'mtv-outline', class: 'mtv-outline mtv-outline--pink' },
        { color: 'neutral', variant: 'mtv-outline', class: 'mtv-outline' },
        { color: 'error', variant: 'mtv-outline', class: 'mtv-outline mtv-outline--cyan' },
        { variant: 'mtv-outline', class: 'mtv-outline' },

        // === MTV-SOFT (yellow sticker slab) ===
        { color: 'primary', variant: 'mtv-soft', class: 'mtv-soft' },
        { color: 'neutral', variant: 'mtv-soft', class: 'mtv-soft mtv-soft--purple' },
        { color: 'error', variant: 'mtv-soft', class: 'mtv-soft mtv-soft--cyan' },
        { variant: 'mtv-soft', class: 'mtv-soft' },

        // === MTV-GHOST ===
        { color: 'primary', variant: 'mtv-ghost', class: 'mtv-ghost' },
        { color: 'neutral', variant: 'mtv-ghost', class: 'mtv-ghost' },
        { color: 'error', variant: 'mtv-ghost', class: 'mtv-ghost mtv-ghost--cyan' },
        { variant: 'mtv-ghost', class: 'mtv-ghost' },

        // === MTV-LINK (highlighter swipe) ===
        { color: 'primary', variant: 'mtv-link', class: 'mtv-link' },
        { color: 'neutral', variant: 'mtv-link', class: 'mtv-link mtv-link--cyan' },
        { color: 'error', variant: 'mtv-link', class: 'mtv-link mtv-link--yellow' },
        { variant: 'mtv-link', class: 'mtv-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          mtv: {
            root: 'mtv-input',
            base: 'mtv-input-base'
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
          mtv: 'mtv-input-base'
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
          mtv: {
            root: 'mtv-input',
            base: 'mtv-input-base'
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
          mtv: {
            root: 'mtv-card',
            header: 'mtv-card-header',
            body: 'mtv-card-body',
            footer: 'mtv-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          mtv: {
            border: 'mtv-separator'
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
          mtv: 'mtv-badge'
        }
      }
    }
  }
})
