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
A review card on a PR that changes `packages/<name>/` carries `payload.packages = [{ name, why, approval }]` (why = the
closed issue's 👤 For humans section, approval = its `Packages-approved:` line); the card shows one ⚠️ line per package
(`app/utils/package-lines.ts`, `app/components/cards/Packages.vue`).
A card whose ticket is claimed by a chat (#4019) — directly, or via its parent epic up to 3 hops; a PR card uses its
`Closes #N` issue — carries `payload.claim = { chat, name }` and shows a `<chat> · <name>` badge
(`server/utils/claim-core.ts`, a copy of `activeClaim` from `scripts/lib/chat-claim.mjs` — keep in step;
`app/utils/claim-badge.ts`). Only open `claimed`-labelled issues are read; a failed claim read keeps each card's stored claim.

Stuck cards (#3880): also `issue` link cards (a `Stuck` badge, no buttons), `payload.stuck` =
`quiet` (an open `work-this`/`delegate`/`delegate-pi` ticket — not an epic, not `status:blocked`/`traffic:waiting`,
no open `Closes #n` PR labelled `status:needs-merge` — with no activity and no `Closes #n` PR updated for 3 h;
key `quiet:<updated_at>`), `draft` (a `nuxt-harness[bot]` draft PR untouched for 1 h that is not a sign-off hold,
not `status:needs-merge`, and whose issue is not blocked; key `draft:<head sha>:<updated_at>`, so a touch then a new silence makes a new card; its issue gets no quiet card),
`epic-sync` (an open epic whose branch still lacks the `main` commit from the time of its bot
`<!-- epic-sync:conflict -->` comment; a missing branch → stale; key = the comment id). The sync response adds
`stuck: { quiet, draft, epicSync }` — stuck cards waiting after the sync. Known gap: `scripts/sync-epic-branch.sh`
posts that conflict comment once per epic, so a second conflict after a fix makes no new card.

Answering a card: `POST /api/cards/[cardId]/answer` posts the reply via `postReply` with `since = askedAt`,
and refuses every answer unless `GET /api/cards/token-account` reports `pmcp` (the pipeline acts only on the
owner's own comments). The param is `cardId`, never `id` — crouton reads `id` as the team.
It answers `review` cards (`ok`/`not-ok`) and `delivery` cards (`works` → posts `ok`, `not-ok` → `not ok: <note>`).
A `quiz` card takes `{ answer: '1B 2A 3C' }` instead of a verdict: one A/B/C/? per statement, checked with a copy of
`parseAnswers` from `scripts/owner-quiz.mjs` (`app/utils/quiz-core.ts`, keep in step); it never posts `ok`.
The quiz card is `app/components/cards/QuizCard.vue`; a quiz with no readable `payload.questions` stays a placeholder.
The delivery card (`app/components/cards/Delivery.vue`, rules in `app/utils/delivery-core.ts`) opens the app
signed in via `loginHrefFor` → `/api/status/login/<payload.app>`; no `payload.app` → only the epic link.

Pages: `/` is the inbox (Waiting for you: waiting cards, newest first; list/answer rules in `app/utils/inbox-core.ts`);
`/apps` is the four-tab page (Apps, To test, Decisions, Changelog).

## Clock

The Worker's cron (`*/10 * * * *`, in `env.staging.triggers` of `wrangler.jsonc` only, so PR previews and
production get none) fires `server/plugins/clock.ts`, which calls `onTick` in `server/utils/clock-tick.ts`.
It does nothing unless the Worker has `CLOCK_ENABLED=1`; then it mints one Harness App installation token
(`server/utils/github-app.ts`, a copy of crouton-feedback's `githubApp.ts`; env `HARNESS_APP_ID`,
`HARNESS_APP_PRIVATE_KEY`, `HARNESS_APP_INSTALLATION_ID`, pushed by deploy-app.yml on staging only — never
the owner's `GITHUB_TOKEN`) and starts each job due in that 10-minute slot (`dueJobs` in
`server/utils/clock-jobs.ts`) with `workflow_dispatch` on `main`, logging `clock: <workflow> → <status>`.
A tick that never arrives is skipped, with no catch-up. The clock only starts workflows; it does not sync
cards. To add a job: add a row to `CLOCK_JOBS`, give the workflow `workflow_dispatch`, and remove its `schedule:`.

## Owner email

The single email allowed to sign in is read from the Worker var `NUXT_STATUS_OWNER_EMAIL` only.
It is never committed (public repo). The owner sets it on the Worker (Cloudflare dashboard or
`wrangler secret/var` for the `staging` and production environments). Unset = nobody can sign in.

Local dev: put it in an untracked `.env` as `NUXT_STATUS_OWNER_EMAIL=...`.
