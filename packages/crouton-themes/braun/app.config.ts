// Braun / Rams Hi-Fi Theme Configuration (#1309)
// Warm analog hardware: cream chassis, precise hairlines, machined radii,
// the one signature orange. As little design as possible — but tactile.

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'orange',
      neutral: 'stone'
    },

    button: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'braun': '',
          'braun-solid': '',
          'braun-outline': '',
          'braun-soft': '',
          'braun-ghost': '',
          'braun-link': ''
        }
      },
      compoundVariants: [
        // === BRAUN (machined keys) ===
        { color: 'primary', variant: 'braun', class: 'braun-btn braun-btn--orange' },
        { color: 'neutral', variant: 'braun', class: 'braun-btn braun-btn--charcoal' },
        { color: 'error', variant: 'braun', class: 'braun-btn braun-btn--red' },
        { variant: 'braun', class: 'braun-btn' },

        // === BRAUN-SOLID (alias) ===
        { color: 'primary', variant: 'braun-solid', class: 'braun-btn braun-btn--orange' },
        { color: 'neutral', variant: 'braun-solid', class: 'braun-btn braun-btn--charcoal' },
        { color: 'error', variant: 'braun-solid', class: 'braun-btn braun-btn--red' },
        { variant: 'braun-solid', class: 'braun-btn' },

        // === BRAUN-OUTLINE (hairline key) ===
        { color: 'primary', variant: 'braun-outline', class: 'braun-outline braun-outline--orange' },
        { color: 'neutral', variant: 'braun-outline', class: 'braun-outline' },
        { color: 'error', variant: 'braun-outline', class: 'braun-outline braun-outline--red' },
        { variant: 'braun-outline', class: 'braun-outline' },

        // === BRAUN-SOFT (recessed key) ===
        { color: 'primary', variant: 'braun-soft', class: 'braun-soft braun-soft--orange' },
        { color: 'neutral', variant: 'braun-soft', class: 'braun-soft' },
        { color: 'error', variant: 'braun-soft', class: 'braun-soft braun-soft--red' },
        { variant: 'braun-soft', class: 'braun-soft' },

        // === BRAUN-GHOST (silkscreen label) ===
        { color: 'primary', variant: 'braun-ghost', class: 'braun-ghost braun-ghost--orange' },
        { color: 'neutral', variant: 'braun-ghost', class: 'braun-ghost' },
        { color: 'error', variant: 'braun-ghost', class: 'braun-ghost braun-ghost--red' },
        { variant: 'braun-ghost', class: 'braun-ghost' },

        // === BRAUN-LINK (index line) ===
        { color: 'primary', variant: 'braun-link', class: 'braun-link braun-link--orange' },
        { color: 'neutral', variant: 'braun-link', class: 'braun-link' },
        { color: 'error', variant: 'braun-link', class: 'braun-link braun-link--red' },
        { variant: 'braun-link', class: 'braun-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          braun: {
            root: 'braun-input',
            base: 'braun-input-base'
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
          braun: 'braun-input-base'
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
          braun: {
            root: 'braun-input',
            base: 'braun-input-base'
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
          braun: {
            root: 'braun-card',
            header: 'braun-card-header',
            body: 'braun-card-body',
            footer: 'braun-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          braun: {
            border: 'braun-separator'
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
          braun: 'braun-badge'
        }
      }
    },

    selectMenu: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          braun: "braun-input-base"
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
          braun: {
            list: "braun-tabs-list",
            trigger: "braun-tabs-trigger",
            indicator: "braun-tabs-indicator"
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
          braun: {
            base: "braun-check-box",
            indicator: "braun-check-indicator"
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
          braun: {
            base: "braun-radio-box",
            indicator: "braun-radio-indicator"
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
          braun: {
            root: "braun-alert",
            title: "braun-alert-title"
          }
        }
      },
      compoundVariants: [
        { color: "primary", variant: "braun", class: { root: "braun-alert--primary" } },
        { color: "warning", variant: "braun", class: { root: "braun-alert--warning" } },
        { color: "error", variant: "braun", class: { root: "braun-alert--error" } },
        { color: "neutral", variant: "braun", class: { root: "braun-alert--neutral" } }
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
          braun: {
            headingLabel: "braun-cal-heading",
            headCell: "braun-cal-head",
            cellTrigger: "braun-cal-cell"
          }
        }
      }
    }
  }
})
