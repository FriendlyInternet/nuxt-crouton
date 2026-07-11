// KO-UI Theme Configuration
// Hardware-inspired styling based on Teenage Engineering KO II

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'orange',
      neutral: 'stone'
    },

    button: {
      // Subtractive base via the shared marker-gated replacer (#1304): when the
      // resolved classes carry a ko-* marker, the defaults KO's CSS re-supplies
      // (color/decoration/motion/typography) are stripped, so the CSS below
      // needs no !important. Unmarked (non-ko) renders pass through untouched.
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          ko: '',
          'ko-solid': '',
          'ko-outline': '',
          'ko-soft': '',
          'ko-ghost': '',
          'ko-link': ''
        }
      },

      // Define KO styling for each color via compoundVariants
      compoundVariants: [
        // KO + Primary (orange)
        {
          color: 'primary',
          variant: 'ko',
          class: 'ko-bezel ko-bezel--orange'
        },
        // KO + Neutral (dark gray)
        {
          color: 'neutral',
          variant: 'ko',
          class: 'ko-bezel ko-bezel--dark'
        },
        // KO + Error (red)
        {
          color: 'error',
          variant: 'ko',
          class: 'ko-bezel ko-bezel--red'
        },
        // KO + Secondary (pink)
        {
          color: 'secondary',
          variant: 'ko',
          class: 'ko-bezel ko-bezel--pink'
        },
        // KO + Info (blue)
        {
          color: 'info',
          variant: 'ko',
          class: 'ko-bezel ko-bezel--blue'
        },
        // KO default (gray) - when no color specified or for fallback
        {
          variant: 'ko',
          class: 'ko-bezel'
        },

        // === KO-SOLID (same as base ko) ===
        { variant: 'ko-solid', color: 'primary', class: 'ko-bezel ko-bezel--orange' },
        { variant: 'ko-solid', color: 'neutral', class: 'ko-bezel ko-bezel--dark' },
        { variant: 'ko-solid', color: 'error', class: 'ko-bezel ko-bezel--red' },
        { variant: 'ko-solid', color: 'secondary', class: 'ko-bezel ko-bezel--pink' },
        { variant: 'ko-solid', color: 'info', class: 'ko-bezel ko-bezel--blue' },
        { variant: 'ko-solid', class: 'ko-bezel' },

        // === KO-OUTLINE ===
        { variant: 'ko-outline', color: 'primary', class: 'ko-outline ko-outline--orange' },
        { variant: 'ko-outline', color: 'neutral', class: 'ko-outline ko-outline--dark' },
        { variant: 'ko-outline', color: 'error', class: 'ko-outline ko-outline--red' },
        { variant: 'ko-outline', color: 'secondary', class: 'ko-outline ko-outline--pink' },
        { variant: 'ko-outline', color: 'info', class: 'ko-outline ko-outline--blue' },
        { variant: 'ko-outline', class: 'ko-outline' },

        // === KO-SOFT ===
        { variant: 'ko-soft', color: 'primary', class: 'ko-soft ko-soft--orange' },
        { variant: 'ko-soft', color: 'neutral', class: 'ko-soft ko-soft--dark' },
        { variant: 'ko-soft', color: 'error', class: 'ko-soft ko-soft--red' },
        { variant: 'ko-soft', color: 'secondary', class: 'ko-soft ko-soft--pink' },
        { variant: 'ko-soft', color: 'info', class: 'ko-soft ko-soft--blue' },
        { variant: 'ko-soft', class: 'ko-soft' },

        // === KO-GHOST ===
        { variant: 'ko-ghost', color: 'primary', class: 'ko-ghost ko-ghost--orange' },
        { variant: 'ko-ghost', color: 'neutral', class: 'ko-ghost ko-ghost--dark' },
        { variant: 'ko-ghost', color: 'error', class: 'ko-ghost ko-ghost--red' },
        { variant: 'ko-ghost', color: 'secondary', class: 'ko-ghost ko-ghost--pink' },
        { variant: 'ko-ghost', color: 'info', class: 'ko-ghost ko-ghost--blue' },
        { variant: 'ko-ghost', class: 'ko-ghost' },

        // === KO-LINK ===
        { variant: 'ko-link', color: 'primary', class: 'ko-link ko-link--orange' },
        { variant: 'ko-link', color: 'neutral', class: 'ko-link ko-link--dark' },
        { variant: 'ko-link', color: 'error', class: 'ko-link ko-link--red' },
        { variant: 'ko-link', color: 'secondary', class: 'ko-link ko-link--pink' },
        { variant: 'ko-link', color: 'info', class: 'ko-link ko-link--blue' },
        { variant: 'ko-link', class: 'ko-link' }
      ]
    },

    // INPUT OVERRIDES
    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      // Add 'ko' to the variant options
      variants: {
        variant: {
          ko: {
            root: 'ko-input',
            base: 'ko-input-base'
          }
        }
      }
    },

    // CARD OVERRIDES
    card: {
      slots: {
        root: subtractThemeDefaults,
        header: subtractThemeDefaults,
        body: subtractThemeDefaults,
        footer: subtractThemeDefaults
      },
      // Add 'ko' to the variant options
      variants: {
        variant: {
          ko: {
            root: 'ko-card',
            header: 'ko-card-header',
            body: 'ko-card-body',
            footer: 'ko-card-footer'
          }
        }
      }
    },

    // #1333-deferred coverage, landed with #1393: selects + textarea reuse the
    // ko-input chrome.
    select: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          ko: "ko-input-base"
        }
      }
    },

    selectMenu: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          ko: "ko-input-base"
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
          ko: {
            root: "ko-input",
            base: "ko-input-base"
          }
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
          ko: {
            list: "ko-tabs-list",
            trigger: "ko-tabs-trigger",
            indicator: "ko-tabs-indicator"
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
          ko: {
            base: "ko-check-box",
            indicator: "ko-check-indicator"
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
          ko: {
            base: "ko-radio-box",
            indicator: "ko-radio-indicator"
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
          ko: {
            root: "ko-alert",
            title: "ko-alert-title"
          }
        }
      },
      compoundVariants: [
        { color: "primary", variant: "ko", class: { root: "ko-alert--primary" } },
        { color: "warning", variant: "ko", class: { root: "ko-alert--warning" } },
        { color: "error", variant: "ko", class: { root: "ko-alert--error" } },
        { color: "neutral", variant: "ko", class: { root: "ko-alert--neutral" } }
      ]
    }
  }
})
