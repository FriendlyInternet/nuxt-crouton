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

    select: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          eink: 'eink-input-base'
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
    },

    selectMenu: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          eink: "eink-input-base"
        }
      }
    },

    // #1393 component coverage — indicator hidden, active state on the
    // trigger (the pill/link positioning compounds never fire for a named
    // variant, and instant state changes fit the theme anyway).
    tabs: {
      slots: {
        list: subtractThemeDefaults,
        trigger: subtractThemeDefaults,
        indicator: subtractThemeDefaults
      },
      variants: {
        variant: {
          eink: {
            list: "eink-tabs-list",
            trigger: "eink-tabs-trigger",
            indicator: "eink-tabs-indicator"
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
          eink: {
            base: "eink-check-box",
            indicator: "eink-check-indicator"
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
          eink: {
            base: "eink-radio-box",
            indicator: "eink-radio-indicator"
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
          eink: {
            root: "eink-alert",
            title: "eink-alert-title"
          }
        }
      },
      compoundVariants: [
        { color: "primary", variant: "eink", class: { root: "eink-alert--primary" } },
        { color: "warning", variant: "eink", class: { root: "eink-alert--warning" } },
        { color: "error", variant: "eink", class: { root: "eink-alert--error" } },
        { color: "neutral", variant: "eink", class: { root: "eink-alert--neutral" } }
      ]
    }
  }
})
