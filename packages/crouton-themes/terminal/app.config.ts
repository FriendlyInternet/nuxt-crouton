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
    },

    selectMenu: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          terminal: "term-input-base"
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
          terminal: {
            list: "term-tabs-list",
            trigger: "term-tabs-trigger",
            indicator: "term-tabs-indicator"
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
          terminal: {
            base: "term-check-box",
            indicator: "term-check-indicator"
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
          terminal: {
            base: "term-radio-box",
            indicator: "term-radio-indicator"
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
          terminal: {
            root: "term-alert",
            title: "term-alert-title"
          }
        }
      },
      compoundVariants: [
        { color: "primary", variant: "terminal", class: { root: "term-alert--primary" } },
        { color: "warning", variant: "terminal", class: { root: "term-alert--warning" } },
        { color: "error", variant: "terminal", class: { root: "term-alert--error" } },
        { color: "neutral", variant: "terminal", class: { root: "term-alert--neutral" } }
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
          terminal: {
            headingLabel: "term-cal-heading",
            headCell: "term-cal-head",
            cellTrigger: "term-cal-cell"
          }
        }
      }
    }
  }
})
