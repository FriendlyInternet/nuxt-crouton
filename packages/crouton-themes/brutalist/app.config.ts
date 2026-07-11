// Brutalist Theme Configuration (#1307)
// Thick black borders, hard offset shadows, flat shock fills, instant states.

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'yellow',
      neutral: 'neutral'
    },

    button: {
      // Subtractive base via the shared marker-gated replacer (#1304): fires
      // only when a brutalist-* marker is in the resolved classes; strips the
      // defaults this CSS re-supplies (color/decoration/motion/weight).
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'brutalist': '',
          'brutalist-solid': '',
          'brutalist-outline': '',
          'brutalist-soft': '',
          'brutalist-ghost': '',
          'brutalist-link': ''
        }
      },
      compoundVariants: [
        // === BRUTALIST (solid blocks) ===
        { color: 'primary', variant: 'brutalist', class: 'brutalist-btn brutalist-btn--primary' },
        { color: 'neutral', variant: 'brutalist', class: 'brutalist-btn brutalist-btn--neutral' },
        { color: 'error', variant: 'brutalist', class: 'brutalist-btn brutalist-btn--error' },
        { variant: 'brutalist', class: 'brutalist-btn' },

        // === BRUTALIST-SOLID (alias of base) ===
        { color: 'primary', variant: 'brutalist-solid', class: 'brutalist-btn brutalist-btn--primary' },
        { color: 'neutral', variant: 'brutalist-solid', class: 'brutalist-btn brutalist-btn--neutral' },
        { color: 'error', variant: 'brutalist-solid', class: 'brutalist-btn brutalist-btn--error' },
        { variant: 'brutalist-solid', class: 'brutalist-btn' },

        // === BRUTALIST-OUTLINE (white block, black frame) ===
        { color: 'primary', variant: 'brutalist-outline', class: 'brutalist-outline brutalist-outline--primary' },
        { color: 'neutral', variant: 'brutalist-outline', class: 'brutalist-outline' },
        { color: 'error', variant: 'brutalist-outline', class: 'brutalist-outline brutalist-outline--error' },
        { variant: 'brutalist-outline', class: 'brutalist-outline' },

        // === BRUTALIST-SOFT (accent block, no shadow) ===
        { color: 'primary', variant: 'brutalist-soft', class: 'brutalist-soft brutalist-soft--primary' },
        { color: 'neutral', variant: 'brutalist-soft', class: 'brutalist-soft' },
        { color: 'error', variant: 'brutalist-soft', class: 'brutalist-soft brutalist-soft--error' },
        { variant: 'brutalist-soft', class: 'brutalist-soft' },

        // === BRUTALIST-GHOST (frame on hover only) ===
        { color: 'primary', variant: 'brutalist-ghost', class: 'brutalist-ghost' },
        { color: 'neutral', variant: 'brutalist-ghost', class: 'brutalist-ghost' },
        { color: 'error', variant: 'brutalist-ghost', class: 'brutalist-ghost brutalist-ghost--error' },
        { variant: 'brutalist-ghost', class: 'brutalist-ghost' },

        // === BRUTALIST-LINK (marker-pen underline) ===
        { color: 'primary', variant: 'brutalist-link', class: 'brutalist-link' },
        { color: 'neutral', variant: 'brutalist-link', class: 'brutalist-link' },
        { color: 'error', variant: 'brutalist-link', class: 'brutalist-link brutalist-link--error' },
        { variant: 'brutalist-link', class: 'brutalist-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          brutalist: {
            root: 'brutalist-input',
            base: 'brutalist-input-base'
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
          brutalist: 'brutalist-input-base'
        }
      }
    },

    selectMenu: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          brutalist: 'brutalist-input-base'
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
          brutalist: {
            root: 'brutalist-input',
            base: 'brutalist-input-base'
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
          brutalist: {
            root: 'brutalist-card',
            header: 'brutalist-card-header',
            body: 'brutalist-card-body',
            footer: 'brutalist-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          brutalist: {
            border: 'brutalist-separator'
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
          brutalist: 'brutalist-badge'
        }
      }
    },

    // #1393 component coverage. Tabs: the sliding indicator is hidden (CSS)
    // and active state lives on the trigger — brutalist states snap, they
    // don't glide. The positioning compoundVariants only fire for pill/link,
    // so a named variant must own indicator geometry anyway.
    tabs: {
      slots: {
        list: subtractThemeDefaults,
        trigger: subtractThemeDefaults,
        indicator: subtractThemeDefaults
      },
      variants: {
        variant: {
          brutalist: {
            list: 'brutalist-tabs-list',
            trigger: 'brutalist-tabs-trigger',
            indicator: 'brutalist-tabs-indicator'
          }
        }
      }
    },

    checkbox: {
      slots: {
        base: subtractThemeDefaults,
        indicator: subtractThemeDefaults
      },
      variants: {
        variant: {
          brutalist: {
            base: 'brutalist-check-box',
            indicator: 'brutalist-check-indicator'
          }
        }
      }
    },

    radioGroup: {
      slots: {
        base: subtractThemeDefaults,
        indicator: subtractThemeDefaults
      },
      variants: {
        variant: {
          brutalist: {
            base: 'brutalist-radio-box',
            indicator: 'brutalist-radio-indicator'
          }
        }
      }
    },

    // Alert colors live in compoundVariants keyed to the STANDARD variants,
    // so a named variant starts blank — the theme supplies its own compounds.
    alert: {
      slots: {
        root: subtractThemeDefaults,
        title: subtractThemeDefaults
      },
      variants: {
        variant: {
          brutalist: {
            root: 'brutalist-alert',
            title: 'brutalist-alert-title'
          }
        }
      },
      compoundVariants: [
        { color: 'primary', variant: 'brutalist', class: { root: 'brutalist-alert--primary' } },
        { color: 'warning', variant: 'brutalist', class: { root: 'brutalist-alert--primary' } },
        { color: 'error', variant: 'brutalist', class: { root: 'brutalist-alert--error' } },
        { color: 'neutral', variant: 'brutalist', class: { root: 'brutalist-alert--neutral' } }
      ]
    }
  }
})
