# status

Owner-only status app (magic-link sign-in, no passwords/passkeys).

Data: one collection, `cards` (layer `inbox`, table `inbox_cards`), on the seeded team `test1`
(one-team mode); its `seed.json` is kept at `rows: []` on purpose so no sample cards reach status.pmcp.dev.
The `state: 'waiting'` form default in `useInboxCards.ts` is a hand-edit (the generator ignores
`meta.default` for string fields) — keep it when regenerating.

Cards are filled by `runCardsSync` (`server/utils/cards-sync-run.ts`), run by `POST /api/cards/sync` (owner-only, the
inbox page on load) and by the clock at :00 and :30 UTC, and on any 10-minute tick after a GitHub webhook marked a change (`POST /api/github/webhook`, below) (`server/utils/cards-sync-clock.ts`; owner =
`NUXT_STATUS_OWNER_EMAIL`, team `test1`; both share the 60 s throttle key `cards-sync:last:<team>`): it reads GitHub live,
upserts one card per waiting ask under the owner's team, never changes a card answered from the inbox, and leaves an
item's cards untouched when its GitHub read fails. A failed card save never stops the others or answers 500: the sync
answers 200 with `error` (how many saves failed and the first message), and the inbox shows it as "Refreshed with
problems". Rules live in `server/utils/cards-sync-core.ts` (copies of `scripts/`
logic — keep in step).
A review card on a PR that changes `packages/<name>/` carries `payload.packages = [{ name, why, approval }]` (why = the
closed issue's 👤 For humans section, approval = its `Packages-approved:` line); the card shows one ⚠️ line per package
(`app/utils/package-lines.ts`, `app/components/cards/Packages.vue`).
Every PR review card whose file list was read also carries `payload.changes = { files, added, removed, top }` (top = the
3 largest files, ties by name); the card shows one muted "N files · +A −R · …" line with a "See the code changes" link
(`app/utils/change-line.ts`, `app/components/cards/Changes.vue`).
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
`/apps` is the six-tab page (Apps, To test, Decisions, Changelog, Clock, Pipeline).
The Changelog tags each merged PR from its linked issue's `app:`/`poc:`/`pkg:` label (one cached issue search in `changelog.get.ts`, rules in `server/utils/changelog-core.ts`; bookkeeping labels never decide a tag), groups rows by Brussels day and hides chores behind "Show chores".

## Pipeline board

The **Pipeline** tab (#4349, `components/dashboard/PipelineTab.vue` + `PipelineCard.vue`) shows every open pipeline
ticket as a card in one of six columns: Queued · Working · In review · Waits on you · To test · Done today. It is a
read-only `CroutonKanban` (`readonly`, cards can't be dragged); tapping a card opens the ticket on GitHub. The page
re-reads `GET /api/status/board` every 30 s while visible (D1 only, never GitHub).
Rows live in the `items` collection, layer `pipeline` (table `pipeline_items`, one row per issue; a PR folds into the
issue its body closes). The column is worked out at READ time by `stageOf` in `server/utils/board-core.ts` from the row
and the current waiting inbox cards (a PR card counts for the row whose `prNumber` it is), first rule wins: closed
≤ 24 h → done (older: hidden) · `traffic:waiting` → queued · `status:to-test` → test · `epic` → hidden · a waiting
card → you · an open PR with no `no-go` on its head → review · `work-this`/`delegate`/`delegate-pi`/`plan:approved`
(or a `no-go` head) → working · else hidden. Planning and building are one Working column.
Writer: the inbox card sync (`writeBoard` in `cards-sync-run.ts`, rules in `boardFromLists`) at the end of every run,
from the lists it already read — no extra GitHub reads. It writes a new row only when `stageOf` gives a column;
`stageSince`/`order` move only when the stage changes. Only when every list read succeeded: a row missing from the
lists gets `closedAt`, a row whose PR is no longer open loses its PR fields, and rows closed > 24 h ago are deleted.
A failed board write lands in the sync's `error` and never changes the card counts. The `checksRed`/`checksSha`
columns (red-check badge) are filled by the webhook writer in #4350; until then the badge never shows.

## Clock

The Worker's cron (`*/10 * * * *`, in `env.staging.triggers` of `wrangler.jsonc` only, so PR previews and
production get none) fires `server/plugins/clock.ts`, which calls `onTick` in `server/utils/clock-tick.ts`.
It does nothing unless the Worker has `CLOCK_ENABLED=1`; then it mints one Harness App installation token
(`server/utils/github-app.ts`, a copy of crouton-feedback's `githubApp.ts`; env `HARNESS_APP_ID`,
`HARNESS_APP_PRIVATE_KEY`, `HARNESS_APP_INSTALLATION_ID`, pushed by deploy-app.yml on staging only — never
the owner's `GITHUB_TOKEN`) and starts each job due in that 10-minute slot (`dueJobs` in
`server/utils/clock-jobs.ts`) with `workflow_dispatch` on `main` and input `clock: 'true'` (so a gated
workflow behaves as its timed run, not a hand start), logging `clock: <workflow> → <status>`.
A row has `every` (`hour` | `day` | `week` | `month`) and `minute`, plus `hour` for day/week/month,
`weekday` for week (0 = Sunday, as cron) and `day` for month; all times UTC.
A tick that never arrives is skipped, with no catch-up. In the :00 and :30 slots, or any slot where KV `cards-sync:dirty-at` is newer than `cards-sync:synced-from` minus 6 min, it also runs the inbox card sync (at most one a tick; only an ok, unthrottled run advances `synced-from`) with
the owner's `GITHUB_TOKEN` (not the App token), before and independent of the dispatches, and writes
`clock:cards-sync:last` = `{ at, ok, counts, readErrors, error? }` to KV. To add a job: add a row to `CLOCK_JOBS`, give the workflow `workflow_dispatch` with a boolean `clock`
input, make any manual-only branch check `!inputs.clock`, and remove its `schedule:`.
The **Clock** tab (`components/dashboard/ClockTab.vue`, fed by `GET /api/status/clock`) shows each job's last due slot,
whether a clock run (workflow_dispatch by `nuxt-harness[bot]`, titled the workflow's name) started within 20 min of it
and how it ended, and the next due slot; rules in `server/utils/clock-status-core.ts`. A clock run cancelled before it
started a job counts as ran when a run of the same workflow (any actor or event) created within 20 min after it
succeeded; its link then opens that run. A 403 on the runs list means the
status token needs Actions: read (every row shows `unknown`). A 14th row, `inbox stuck check`, is built from that KV
record (`cardsSyncStatus` in `clock-status-core.ts`): ok < 40 min, failed when `ok` is false, missed when older, grey
`before-clock` with no record before `CARDS_SYNC_SINCE` or on a Worker without the clock; its read errors are row text,
not the tab banner.

## GitHub webhook

`POST /api/github/webhook` (#4309, rules in `server/utils/webhook-core.ts`) lets a GitHub change reach the inbox within
~10 min instead of up to 30. It checks `X-Hub-Signature-256` against the Worker secret `GITHUB_WEBHOOK_SECRET` (pushed
by deploy-app.yml from the repo secret `STATUS_WEBHOOK_SECRET`; bad/missing → 401, nothing stored), answers `ping` 200,
ignores any repo but `runtimeConfig.githubRepo` and any event but issues / issue_comment / pull_request /
pull_request_review (204), never calls GitHub, and only writes KV `cards-sync:dirty-at` (at most every 5 min) → 202.
The next clock tick syncs when that mark is newer than `cards-sync:synced-from` − 6 min. Two never-cleared timestamps,
not a flag the clock clears, because KV reads can be ~60 s stale: a cleared flag could make a webhook skip its write
and lose the change. The inbox page (`/`) re-reads its stored cards (no GitHub sync) every 30 s while visible and when
the tab becomes visible again (`rereadDue` / `relistInbox` in `app/utils/inbox-core.ts`).
Owner step: set the repo secret `STATUS_WEBHOOK_SECRET`, redeploy, then add a repo webhook (Settings → Webhooks) at
`https://status.pmcp.dev/api/github/webhook`, content type `application/json`, the same secret, events Issues,
Issue comments, Pull requests, Pull request reviews.

## Owner email

The single email allowed to sign in is read from the Worker var `NUXT_STATUS_OWNER_EMAIL` only.
It is never committed (public repo). The owner sets it on the Worker (Cloudflare dashboard or
`wrangler secret/var` for the `staging` and production environments). Unset = nobody can sign in.

Local dev: put it in an untracked `.env` as `NUXT_STATUS_OWNER_EMAIL=...`.
