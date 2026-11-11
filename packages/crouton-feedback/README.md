# @fyit/crouton-feedback

A **drop-in in-page feedback toolkit for any Nuxt + Nuxt UI 4 app**. It adds one
neutral **glasses** launcher in the bottom-right corner with these toggleable tools:

- **Console** — an in-page mobile devtools console (eruda), lazy-loaded on demand.
- **Annotate** — click any element on the page, write a comment, and send it to
  wherever you want feedback to go.
- **Changelog** — a `vNN`-badged version timeline, fed by a committed
  `changelog.json` (see below). Handy on staging previews to see which build
  you're looking at. Hidden when no changelog is provided.

The send destination is a **pluggable sink** you pick in config:

| Sink | Where feedback lands |
|------|----------------------|
| `webhook` | A generic JSON `POST` to any URL (n8n, Zapier, your own endpoint) |
| `slack` / `discord` | A formatted message in a channel via an incoming webhook |
| `github` | A comment on a GitHub issue / PR |

**PR-preview guard.** When the `github` sink is bound to a PR (`pr` set), `POST /api/_feedback` needs a signed-in user whose **verified** email is in `NUXT_CROUTON_FEEDBACK_REVIEWER_EMAILS` (comma list; needs `@fyit/crouton-auth`). Anything else — no session, unverified, not listed, empty list, auth missing — returns 401 `Not authorised` (fails closed). Other sinks are unchanged. The deploy workflow sets the list from the review login and skips the bridge when no login exists.

No `@fyit/crouton-core` required — the only peers are `nuxt` and `@nuxt/ui`.

## Install

```bash
pnpm add -D @fyit/crouton-feedback
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@fyit/crouton-feedback']
})
```

The launcher renders in local dev, or in any build that sets
`NUXT_PUBLIC_CROUTON_FEEDBACK=true` (production builds without it ship nothing).

## Configure where feedback goes

Pick a sink via the `croutonFeedback.feedback` option, or override any field at
runtime with its `NUXT_CROUTON_FEEDBACK_*` env var (preferred for secrets):

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@fyit/crouton-feedback'],
  croutonFeedback: {
    feedback: {
      sink: 'webhook',        // 'webhook' | 'slack' | 'discord' | 'github'
      webhookUrl: 'https://…'
    }
  }
})
```

| Sink | Option fields | Env vars |
|------|---------------|----------|
| `webhook` | `webhookUrl` | `NUXT_CROUTON_FEEDBACK_WEBHOOK_URL` |
| `slack` | `slackUrl` | `NUXT_CROUTON_FEEDBACK_SLACK_URL` |
| `discord` | `discordUrl` | `NUXT_CROUTON_FEEDBACK_DISCORD_URL` |
| `github` | `github.{appId,privateKey,installationId,repository,pr}` or `github.token` | `NUXT_CROUTON_FEEDBACK_GITHUB_APP_ID` / `_APP_PRIVATE_KEY` / `_APP_INSTALLATION_ID` / `_TOKEN` / `_REPOSITORY` / `_PR` |
| (any) | `sink` | `NUXT_CROUTON_FEEDBACK_SINK` |

Credentials and URLs live only in **server** runtime config — they never reach
the client bundle. The `github` sink posts as a GitHub App (short-lived token, no
stored credential), with an interim PAT (`github.token`) fallback.

## Show a version timeline (Changelog tool)

Provide a committed `changelog.json` — an array of `{ v, note, commit? }`, newest
first — and the launcher gains a `vNN`-badged **Changelog** row:

```ts
// nuxt.config.ts
croutonFeedback: {
  changelog: {
    path: 'app/changelog.json',                                   // or inline `entries: [...]`
    commitUrlTemplate: 'https://github.com/OWNER/REPO/commit/{commit}'
  }
}
```

`path` is optional — the module auto-detects `<srcDir>/changelog.json`,
`app/changelog.json`, then `changelog.json`. At build it also stamps the current
`git rev-parse --short HEAD` (disable with `stampGitCommit: false`) to fill the
current entry's commit until the next push backfills it. No entries ⇒ the tool
stays hidden.

## License

MIT
