# status

Owner-only status app (magic-link sign-in, no passwords/passkeys).

## Owner email

The single email allowed to sign in is read from the Worker var `NUXT_STATUS_OWNER_EMAIL` only.
It is never committed (public repo). The owner sets it on the Worker (Cloudflare dashboard or
`wrangler secret/var` for the `staging` and production environments). Unset = nobody can sign in.

Local dev: put it in an untracked `.env` as `NUXT_STATUS_OWNER_EMAIL=...`.

## Walk result

`POST /api/walk-result` is called by the Spec-walk overlay (`@fyit/crouton-feedback`) on another
staging app when a card's walk ends in **Send result**. The card's walk link carries `result`
(this app's own origin + `/api/walk-result`). It is a credentialed `fetch` (the owner session cookie is
same-site), so CORS allows exact staging origins from `app-urls.generated.json` only (localhost in
dev), and a POST from any other `Origin` gets a 403. The body is built by `buildWalkReply`
(`ok` / `not ok: <step> — <note>`). The double-post guard reads the issue timeline: an identical
`ok` blocks a re-send only if no commit/PR reference or other verdict came after it. If posting
fails with "missing the Issues: Read and write permission", change `STATUS_GITHUB_TOKEN`.
