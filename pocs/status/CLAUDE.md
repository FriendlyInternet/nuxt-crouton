# status

Owner-only status app (magic-link sign-in, no passwords/passkeys).

## Owner email

The single email allowed to sign in is read from the Worker var `NUXT_STATUS_OWNER_EMAIL` only.
It is never committed (public repo). The owner sets it on the Worker (Cloudflare dashboard or
`wrangler secret/var` for the `staging` and production environments). Unset = nobody can sign in.

Local dev: put it in an untracked `.env` as `NUXT_STATUS_OWNER_EMAIL=...`.
