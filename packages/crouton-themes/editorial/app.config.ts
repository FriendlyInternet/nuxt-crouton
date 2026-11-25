// Editorial Theme Configuration (#4520)
// Book-style serif on white, small sans controls, soft-grey pill buttons.
// Same component coverage as minimal (13 components, badge is a deliberate
// pass — the runtime config keeps it on Nuxt UI's solid).

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
          'editorial': '',
          'editorial-solid': '',
          'editorial-outline': '',
          'editorial-soft': '',
          'editorial-ghost': '',
          'editorial-link': ''
        }
      },
      compoundVariants: [
        { color: 'primary', variant: 'editorial', class: 'editorial-btn editorial-btn--primary' },
        { color: 'neutral', variant: 'editorial', class: 'editorial-btn' },
        { color: 'error', variant: 'editorial', class: 'editorial-btn editorial-btn--alert' },
        { variant: 'editorial', class: 'editorial-btn' },

        { color: 'primary', variant: 'editorial-solid', class: 'editorial-btn editorial-btn--primary' },
        { color: 'neutral', variant: 'editorial-solid', class: 'editorial-btn' },
        { color: 'error', variant: 'editorial-solid', class: 'editorial-btn editorial-btn--alert' },
        { variant: 'editorial-solid', class: 'editorial-btn' },

        // Secondary = no fill + trailing chevron (outline and ghost share it).
        { color: 'primary', variant: 'editorial-outline', class: 'editorial-secondary' },
        { color: 'neutral', variant: 'editorial-outline', class: 'editorial-secondary' },
        { color: 'error', variant: 'editorial-outline', class: 'editorial-secondary editorial-secondary--alert' },
        { variant: 'editorial-outline', class: 'editorial-secondary' },

        { color: 'primary', variant: 'editorial-soft', class: 'editorial-soft' },
        { color: 'neutral', variant: 'editorial-soft', class: 'editorial-soft' },
        { color: 'error', variant: 'editorial-soft', class: 'editorial-soft editorial-soft--alert' },
        { variant: 'editorial-soft', class: 'editorial-soft' },

        { color: 'primary', variant: 'editorial-ghost', class: 'editorial-secondary' },
        { color: 'neutral', variant: 'editorial-ghost', class: 'editorial-secondary' },
        { color: 'error', variant: 'editorial-ghost', class: 'editorial-secondary editorial-secondary--alert' },
        { variant: 'editorial-ghost', class: 'editorial-secondary' },

        { color: 'primary', variant: 'editorial-link', class: 'editorial-link' },
        { color: 'neutral', variant: 'editorial-link', class: 'editorial-link' },
        { color: 'error', variant: 'editorial-link', class: 'editorial-link' },
        { variant: 'editorial-link', class: 'editorial-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          editorial: {
            root: 'editorial-input',
            base: 'editorial-input-base'
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
          editorial: 'editorial-input-base'
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
          editorial: {
            root: 'editorial-input',
            base: 'editorial-input-base'
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
          editorial: {
            root: 'editorial-card',
            header: 'editorial-card-header',
            body: 'editorial-card-body',
            footer: 'editorial-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          editorial: {
            border: 'editorial-separator'
          }
        }
      }
    },

    selectMenu: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          editorial: 'editorial-input-base'
        }
      }
    },

    // Indicator hidden, active state on the trigger (positioning compounds
    // never fire for a named variant).
    tabs: {
      slots: {
        list: subtractThemeDefaults,
        trigger: subtractThemeDefaults,
        indicator: subtractThemeDefaults
      },
      variants: {
        variant: {
          editorial: {
            list: 'editorial-tabs-list',
            trigger: 'editorial-tabs-trigger',
            indicator: 'editorial-tabs-indicator'
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
          editorial: {
            base: 'editorial-check-box',
            indicator: 'editorial-check-indicator'
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
          editorial: {
            base: 'editorial-radio-box',
            indicator: 'editorial-radio-indicator'
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
          editorial: {
            root: 'editorial-alert',
            title: 'editorial-alert-title'
          }
        }
      },
      compoundVariants: [
        { color: 'primary', variant: 'editorial', class: { root: 'editorial-alert--primary' } },
        { color: 'warning', variant: 'editorial', class: { root: 'editorial-alert--warning' } },
        { color: 'error', variant: 'editorial', class: { root: 'editorial-alert--error' } },
        { color: 'neutral', variant: 'editorial', class: { root: 'editorial-alert--neutral' } }
      ]
    },

    calendar: {
      slots: {
        headCell: subtractThemeDefaults,
        cellTrigger: subtractThemeDefaults,
        headingLabel: subtractThemeDefaults
      },
      variants: {
        variant: {
          editorial: {
            headingLabel: 'editorial-cal-heading',
            headCell: 'editorial-cal-head',
            cellTrigger: 'editorial-cal-cell'
          }
        }
      }
    },

    pinInput: {
      slots: { base: subtractThemeDefaults },
      variants: { variant: { editorial: { base: 'editorial-input-base editorial-pin' } } }
    }
  }
})
