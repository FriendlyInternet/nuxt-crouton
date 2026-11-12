# status

Owner-only status app (magic-link sign-in, no passwords/passkeys).

Data: one collection, `cards` (layer `inbox`, table `inbox_cards`), on the seeded team `test1`
(one-team mode); its `seed.json` is kept at `rows: []` on purpose so no sample cards reach status.pmcp.dev.
The `state: 'waiting'` form default in `useInboxCards.ts` is a hand-edit (the generator ignores
`meta.default` for string fields) — keep it when regenerating.

## Owner email

The single email allowed to sign in is read from the Worker var `NUXT_STATUS_OWNER_EMAIL` only.
It is never committed (public repo). The owner sets it on the Worker (Cloudflare dashboard or
`wrangler secret/var` for the `staging` and production environments). Unset = nobody can sign in.

Local dev: put it in an untracked `.env` as `NUXT_STATUS_OWNER_EMAIL=...`.
