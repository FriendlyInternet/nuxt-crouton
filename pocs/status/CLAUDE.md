# status

Owner-only status app (magic-link sign-in, no passwords/passkeys).

Data: one collection, `cards` (layer `inbox`, table `inbox_cards`), on the seeded team `test1`
(one-team mode); its `seed.json` is kept at `rows: []` on purpose so no sample cards reach status.pmcp.dev.
The `state: 'waiting'` form default in `useInboxCards.ts` is a hand-edit (the generator ignores
`meta.default` for string fields) — keep it when regenerating.

Cards are filled by `POST /api/cards/sync` (owner-only, run by the inbox page on load, no cron): it reads GitHub live,
upserts one card per waiting ask under the owner's team, never changes a card answered from the inbox, and leaves an
item's cards untouched when its GitHub read fails. Rules live in `server/utils/cards-sync-core.ts` (copies of `scripts/`
logic — keep in step).

Answering a card: `POST /api/cards/[cardId]/answer` posts the reply via `postReply` with `since = askedAt`,
and refuses every answer unless `GET /api/cards/token-account` reports `pmcp` (the pipeline acts only on the
owner's own comments). The param is `cardId`, never `id` — crouton reads `id` as the team.

Pages: `/` is the inbox (Waiting for you: waiting cards, newest first; list/answer rules in `app/utils/inbox-core.ts`);
`/apps` is the four-tab page (Apps, To test, Decisions, Changelog).

## Owner email

The single email allowed to sign in is read from the Worker var `NUXT_STATUS_OWNER_EMAIL` only.
It is never committed (public repo). The owner sets it on the Worker (Cloudflare dashboard or
`wrangler secret/var` for the `staging` and production environments). Unset = nobody can sign in.

Local dev: put it in an untracked `.env` as `NUXT_STATUS_OWNER_EMAIL=...`.
