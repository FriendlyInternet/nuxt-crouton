// Blueprint Theme Configuration (#1311)
// Cyanotype blue, white line-work, dimension rules, drafting annotations.

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'sky',
      neutral: 'slate'
    },

    button: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          'blueprint': '',
          'blueprint-solid': '',
          'blueprint-outline': '',
          'blueprint-soft': '',
          'blueprint-ghost': '',
          'blueprint-link': ''
        }
      },
      compoundVariants: [
        { color: 'primary', variant: 'blueprint', class: 'bp-btn bp-btn--primary' },
        { color: 'neutral', variant: 'blueprint', class: 'bp-btn' },
        { color: 'error', variant: 'blueprint', class: 'bp-btn bp-btn--alert' },
        { variant: 'blueprint', class: 'bp-btn' },

        { color: 'primary', variant: 'blueprint-solid', class: 'bp-btn bp-btn--primary' },
        { color: 'neutral', variant: 'blueprint-solid', class: 'bp-btn' },
        { color: 'error', variant: 'blueprint-solid', class: 'bp-btn bp-btn--alert' },
        { variant: 'blueprint-solid', class: 'bp-btn' },

        { color: 'primary', variant: 'blueprint-outline', class: 'bp-outline bp-outline--primary' },
        { color: 'neutral', variant: 'blueprint-outline', class: 'bp-outline' },
        { color: 'error', variant: 'blueprint-outline', class: 'bp-outline bp-outline--alert' },
        { variant: 'blueprint-outline', class: 'bp-outline' },

        { color: 'primary', variant: 'blueprint-soft', class: 'bp-soft bp-soft--primary' },
        { color: 'neutral', variant: 'blueprint-soft', class: 'bp-soft' },
        { color: 'error', variant: 'blueprint-soft', class: 'bp-soft bp-soft--alert' },
        { variant: 'blueprint-soft', class: 'bp-soft' },

        { color: 'primary', variant: 'blueprint-ghost', class: 'bp-ghost bp-ghost--primary' },
        { color: 'neutral', variant: 'blueprint-ghost', class: 'bp-ghost' },
        { color: 'error', variant: 'blueprint-ghost', class: 'bp-ghost' },
        { variant: 'blueprint-ghost', class: 'bp-ghost' },

        { color: 'primary', variant: 'blueprint-link', class: 'bp-link bp-link--primary' },
        { color: 'neutral', variant: 'blueprint-link', class: 'bp-link' },
        { color: 'error', variant: 'blueprint-link', class: 'bp-link' },
        { variant: 'blueprint-link', class: 'bp-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          blueprint: {
            root: 'bp-input',
            base: 'bp-input-base'
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
          blueprint: 'bp-input-base'
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
          blueprint: {
            root: 'bp-input',
            base: 'bp-input-base'
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
          blueprint: {
            root: 'bp-card',
            header: 'bp-card-header',
            body: 'bp-card-body',
            footer: 'bp-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          blueprint: {
            border: 'bp-separator'
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
          blueprint: 'bp-badge'
        }
      }
    },

    selectMenu: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          blueprint: "bp-input-base"
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
          blueprint: {
            list: "bp-tabs-list",
            trigger: "bp-tabs-trigger",
            indicator: "bp-tabs-indicator"
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
          blueprint: {
            base: "bp-check-box",
            indicator: "bp-check-indicator"
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
          blueprint: {
            base: "bp-radio-box",
            indicator: "bp-radio-indicator"
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
          blueprint: {
            root: "bp-alert",
            title: "bp-alert-title"
          }
        }
      },
      compoundVariants: [
        { color: "primary", variant: "blueprint", class: { root: "bp-alert--primary" } },
        { color: "warning", variant: "blueprint", class: { root: "bp-alert--warning" } },
        { color: "error", variant: "blueprint", class: { root: "bp-alert--error" } },
        { color: "neutral", variant: "blueprint", class: { root: "bp-alert--neutral" } }
      ]
    }
  }
})
