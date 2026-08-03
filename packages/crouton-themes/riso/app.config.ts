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
    },

    selectMenu: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          riso: "riso-input-base"
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
          riso: {
            list: "riso-tabs-list",
            trigger: "riso-tabs-trigger",
            indicator: "riso-tabs-indicator"
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
          riso: {
            base: "riso-check-box",
            indicator: "riso-check-indicator"
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
          riso: {
            base: "riso-radio-box",
            indicator: "riso-radio-indicator"
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
          riso: {
            root: "riso-alert",
            title: "riso-alert-title"
          }
        }
      },
      compoundVariants: [
        { color: "primary", variant: "riso", class: { root: "riso-alert--primary" } },
        { color: "warning", variant: "riso", class: { root: "riso-alert--warning" } },
        { color: "error", variant: "riso", class: { root: "riso-alert--error" } },
        { color: "neutral", variant: "riso", class: { root: "riso-alert--neutral" } }
      ]
    },

    // #1458 second-tier coverage. Calendar: the color dimension fires on
    // headCell/cellTrigger regardless of variant (like checkbox), so both
    // carry markers + the replacer; selected/today state lives entirely in
    // the theme CSS via [data-selected]/[data-today].
    calendar: {
      slots: {
        headCell: subtractThemeDefaults,
        cellTrigger: subtractThemeDefaults,
        headingLabel: subtractThemeDefaults
      },
      variants: {
        variant: {
          riso: {
            headingLabel: "riso-cal-heading",
            headCell: "riso-cal-head",
            cellTrigger: "riso-cal-cell"
          }
        }
      }
    },

    // #1482: UPinInput reuses this theme's input treatment on each cell
    // (border/bg/focus); the size variant keeps the square geometry.
    pinInput: {
      slots: { base: subtractThemeDefaults },
      variants: { variant: { riso: { base: "riso-input-base" } } }
    }
  }
})
