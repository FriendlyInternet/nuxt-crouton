# #1641 — SEO tab extraction: visual evidence

The SEO tab body moved from `Workspace/Editor.vue` into `Editor/SeoTab.vue`. The
change is a pure extraction, so the acceptance question is only: **does the tab
still render identically?**

| | |
|---|---|
| Before (`main` @ `00d4b3683`) | `1641-seo-tab-before.png` |
| After (`work-1641` @ `a541ceb0d`) | `1641-seo-tab-after.png` |

**The two files are byte-identical** — same size (239,955 bytes), same md5
(`e07a5eee539fad71…`). Not "looks the same": the same pixels.

## How they were captured

Both from the *running* app, not a mockup — same surface, same data, same viewport:

1. `pnpm preview velo` — boots the app, seeds `test1`, mints a review login.
2. Sign in over HTTP and inject the `better-auth` session cookies into the browser
   context. (Driving the login *form* races Nuxt's first-hit route compile and
   silently yields an unauthenticated page — which is exactly how a blank
   screenshot gets captured and passed off as evidence.)
3. `/admin/test1/workspace` → wait for the seeded page **by name**, not for
   "some element" → open it → click the **SEO** tab.
4. Screenshot at 1440×950 @2x.

Surface: Pages Workspace → page `Welkom` (`/welcome`) → SEO tab, showing SEO
Title, SEO Description, Social Image picker, Search Indexing, and the
Search/Social preview — i.e. every control the extracted component owns.
