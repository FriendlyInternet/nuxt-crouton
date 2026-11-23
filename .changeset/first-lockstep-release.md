---
"@fyit/crouton-core": minor
---

First lockstep release: every public `@fyit/*` package now packs and installs on its own
(#3393). Tarballs ship the folders and root files their `nuxt.config.ts` loads (core `modules/`
and `i18n/`, auth and mcp-toolkit `module.ts`, i18n `config-utils.ts`, maps `server/`), packages
that ship `dist/` build it in `prepack`, and runtime imports of `@fyit/crouton-auth` are declared
as peers. The fixed group lifts all 28 packages to 0.2.0 together.
