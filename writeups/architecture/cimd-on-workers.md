# Is CIMD safe on Cloudflare Workers with the "public internet only" fetch?

> Research for [#4120](https://github.com/FriendlyInternet/nuxt-crouton/issues/4120) (epic
> [#4095](https://github.com/FriendlyInternet/nuxt-crouton/issues/4095)). No product code. Written
> 18 Nov 2026 against `@better-auth/cimd@1.7.7`, `@better-auth/oauth-provider@1.7.7`,
> `wrangler@4.151.0` / `workerd@1.20261012.1`, and Cloudflare's docs as published that day.

## The short answer

**No — keep sign-up by registration only (DCR) for now.** Cloudflare's `global_fetch_strictly_public`
setting does not mean "never reach a private address". It decides where requests to *your own
Cloudflare site* go, nothing more. Cloudflare doesn't document any promise about private addresses
for `fetch()`, and Workers gives no way to look up an address once, check it and then use exactly
that address. That is the guarantee the CIMD plugin needs. In a local test with the setting on, the
Worker happily fetched `127.0.0.1`, `localhost`, a public name that points at `127.0.0.1`, a redirect
into a private address, and the machine's cloud-metadata address.

If the owner wants "claude.ai vouches for Claude" before Cloudflare offers a safe fetch, there is
one narrower route (below, *Option B*): only fetch from a short fixed list of known hosts (for
example `claude.ai`). That is a product and security decision for the owner, not something to
switch on quietly. It also goes beyond what the library itself promises.

## What CIMD needs

`cimd()` takes a **required** `fetchClientMetadataResource` option. Its contract
(`@better-auth/cimd@1.7.7` `dist/index.d.mts`, `CimdOptions.fetchClientMetadataResource`):

> The transport MUST resolve the hostname exactly once, reject RFC 6890 special-use addresses, pin
> the approved address for the connection, and refuse redirects. Those guarantees cannot be
> implemented by wrapping the standard Fetch API after DNS resolution, so the application must
> provide them at its runtime-specific network boundary.

The library's own checks before fetching look only at the **text** of the URL.
`validateClientIdUrl` (`dist/index.mjs:38-57`) rejects `https://127.0.0.1/…` or `https://localhost/…`
via `isPublicRoutableHost(parsed.hostname)` (`dist/index.mjs:55`). A normal-looking name like
`127.0.0.1.nip.io` passes, because nothing has looked it up yet. So "what does this name point to?"
is left entirely to the transport. That is the hole the transport has to close.

The same function is reused for `jwks_uri` (`@better-auth/oauth-provider@1.7.7`
`dist/authorize-K1WHCNih.mjs:1297-1306`: `fetchJwksFromUri(jwksUri, fetchClientMetadataResource)`).
So it guards two fetches, not one.

The ready-made Node transport (`@better-auth/cimd/node`, `dist/node.mjs:1-77`) does this with
`dns.lookup({ all: true })`, an `isPublicRoutableHost` check on every answer, and `https.request`
with a custom `lookup` that returns only the checked address. #4096 step 0 found it can't run on
Workers: workerd rejects the `lookup` option, and at velo's `compatibility_date` `2024-09-02`
`node:https` doesn't load at all.

## 1. What `global_fetch_strictly_public` guarantees

Cloudflare's full description
([compatibility flags → "Global fetch() strictly public"](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)):

> When the `global_fetch_strictly_public` compatibility flag is enabled, the global `fetch()`
> function will strictly route requests as if they were made on the public Internet. This means
> requests to a Worker's own zone will loop back to the "front door" of Cloudflare and will be
> treated like a request from the Internet, possibly even looping back to the same Worker again.
> When the `global_fetch_strictly_public` is not enabled, such requests are routed to the zone's
> origin server, ignoring any Workers mapped to the URL and also bypassing Cloudflare security
> settings.

| Question | Answer | Source |
|---|---|---|
| Private ranges (10/8, 172.16/12, 192.168/16) | **Not mentioned.** The flag covers only routing for the Worker's *own zone* | flag doc above |
| Localhost / loopback | **Not mentioned** | flag doc above |
| Link-local / cloud metadata (169.254.0.0/16) | **Not mentioned** | flag doc above |
| Cloudflare-internal | Only the own-zone case: it goes through the front door instead of straight to the origin | flag doc above |
| IPv6 (::1, fc00::/7, fe80::/10, mapped v4) | **Not mentioned** | flag doc above |
| Since which compatibility date | Opt-in only. The doc gives no "Default as of" date, so it is never switched on by a date bump. Velo already sets it (`apps/velo/wrangler.jsonc:15`) | flag doc above |

Cloudflare *does* document a private-address block, but for a different API. TCP sockets
(`connect()`) refuse "Cloudflare IPs, `localhost`, and private network IPs"
([TCP sockets → troubleshooting](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#proxy-request-failed-cannot-connect-to-the-specified-address)).
No matching statement exists for `fetch()`. The closest is that `fetch()` can't take a literal IP
in the URL; you're told to point a DNS name at the IP instead
([known issues → Fetch to IP addresses](https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses)).
That stops the literal case and openly allows the name-based one.

So the documented guarantee is **much narrower** than CIMD's "reject RFC 6890 special-use
addresses". Production may well block private addresses at Cloudflare's edge, but it isn't written
down anywhere. A security boundary that rests on undocumented behaviour can change without notice.

## 2. DNS rebinding and redirects

**Per-request lookup.** `fetch()` from a Worker uses "the Cloudflare DNS resolver"
([known issues → Fetch API in CNAME setup](https://developers.cloudflare.com/workers/platform/known-issues/#fetch-api-in-cname-setup)).
The lookup happens inside Cloudflare's network, not in the Worker. The Worker never sees the
address it connects to, and it can't supply one (no `lookup` option, and literal IPs aren't
allowed). So it **can't resolve once, check and pin**. Looking the name up yourself first (say over
DNS-over-HTTPS) and then calling `fetch(url)` is exactly the check-then-use gap the library warns
about (`isMetadataDocumentUrlAllowed` doc: "resolving here would introduce a TOCTOU boundary"): an
attacker's DNS answers "public" to your check and "private" to the real fetch.

**Redirects.** Workers doesn't support `redirect: "error"`. It throws a `TypeError` when the
request is built
([Request → `redirect`](https://developers.cloudflare.com/workers/runtime-apis/request/#properties)).
`redirect: "manual"` does return the 3xx to the caller without following it. Together with the
library's own `status !== 200 → reject` (`@better-auth/cimd` `dist/index.mjs:359`), that **does**
close the redirect path, *provided the wrapper turns the library's `redirect: "error"`
(`dist/index.mjs:344`) into `"manual"`*. Passed through unchanged, every CIMD fetch would fail with
the generic "network error or redirect blocked" (`dist/index.mjs:253`). Note that `"manual"` only
stops the *redirect* route to a private host. It does nothing for a name that points at one
directly.

## 3. Does a Workers-`fetch` transport meet the contract?

| Contract clause | Workers `fetch` + flag + `redirect: "manual"` |
|---|---|
| Resolve the hostname exactly once | ❌ Not under the Worker's control; Cloudflare's resolver does it out of sight |
| Reject RFC 6890 special-use addresses | ❌ Not documented for `fetch()`. Locally, **not done** (test below) |
| Pin the approved address for the connection | ❌ No API to pass or read the address |
| Refuse redirects | ✅ With `"manual"` (plus a wrapper that maps `"error"` → `"manual"` and rejects 3xx) |

One of four. What's still missing is the whole address-level guarantee, and Workers doesn't offer
it to user code.

## 4. Throwaway check (local `wrangler dev`, not merged)

A scratch Worker outside the repo: `compatibility_date: "2024-09-02"`,
`compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"]`, the same as velo. It
ran under `wrangler@4.151.0` local mode on the CI runner, next to a small HTTP server on
`127.0.0.1:9911` that answers `PRIVATE-SECRET` and has a `/redirect` that sends a 302 to it.

| Probe | Result |
|---|---|
| `http://127.0.0.1:9911/secret` | 200 `PRIVATE-SECRET`: reached |
| `http://localhost:9911/secret` | 200 `PRIVATE-SECRET`: reached |
| `http://127.0.0.1.nip.io:9911/secret` (public name → 127.0.0.1, the rebinding shape) | 200 `PRIVATE-SECRET`: reached |
| `http://169.254.169.254/latest/meta-data/` (cloud metadata) | 404 *from the runner's real metadata service*: reached |
| `/redirect` (default `follow`) | 200 `PRIVATE-SECRET`, `redirected: true`: followed into the private address |
| `/redirect` with `redirect: "manual"` | 302, `location: http://127.0.0.1:9911/secret`: not followed ✅ |
| any URL with `redirect: "error"` | `TypeError: Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).` |
| `https://example.com/` with `"manual"` | 200: a normal public fetch works |

**How much this shows:** local mode is not production. It proves the flag does **no** address
filtering in workerd itself, so nothing at the runtime level stands in for the contract. It can't
prove production lets private addresses through, because Cloudflare's edge may drop them. A
production probe needs a deployed throwaway Worker, and this CI run has no Cloudflare credentials.
Even a clean production probe would only measure current, undocumented behaviour (section 1), so
it wouldn't change the recommendation.

## 5. Recommendation

**Keep DCR only.** Don't add `@better-auth/cimd` to crouton-auth yet. The facts behind this:

- The flag's documented meaning is own-zone routing, not private-address blocking (section 1).
- Workers can't resolve-once-and-pin from user code (section 2), and the library explicitly says a
  wrapper around standard `fetch` can't give the guarantee (its `CimdOptions` doc).
- In local workerd the flag on its own let through loopback, a name pointing to loopback, cloud
  metadata, and followed redirects (section 4).

**What would change the answer**, so a later session knows when to look again:

1. Cloudflare documents that `fetch()` refuses private, loopback, link-local and IPv6 special-use
   addresses after resolving the name (as it already does for `connect()`). Then a transport of
   Workers `fetch` + `redirect: "manual"` + "reject any 3xx" meets the contract in substance, and
   switching on means: add `@better-auth/cimd@1.7.7` (pinned, same line as `better-auth`), pass
   `cimd({ fetchClientMetadataResource })` where that function maps `redirect: "error"` to
   `"manual"`, allows only `GET`/`HEAD`, and rejects 3xx. **No `compatibility_date` bump is needed**
   for the flag, which is opt-in only and already set.
2. **Option B (owner's call): a fixed list of hosts.** Use `isMetadataDocumentUrlAllowed`
   (`CimdOptions`) to accept only `client_id` URLs on a short fixed list (for example
   `https://claude.ai/…`), with the Workers transport above. The attacker then can't pick the
   host, so pointing a name at a private address needs control of claude.ai's own DNS. That shrinks
   the risk a lot, but the library itself says such an allowlist "is application policy, not a
   substitute for the required transport's … guarantees". It also limits CIMD to clients we name
   by hand, which removes most of the point of CIMD over DCR. Choosing this means accepting a
   documented gap, so it is a follow-up ticket for the owner, not part of this one.
