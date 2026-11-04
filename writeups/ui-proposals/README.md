# writeups/ui-proposals

Design records only: the `.html` mockup sources and the `.md` "what changes" lists from
`ui-proposal --static`. **No PNGs live here** (#3351) — they bloated the repo (99 files, 15 MB).

Screenshots are published to a non-branch ref (`refs/review-captures/pr<N>` / `issue<N>`) by
`scripts/publish-review-captures.mjs` and embedded in a PR comment tagged
`<!-- review-capture:<key> -->` by commit-ID raw URL. That comment is the one signal the sign-off
checks look for. The 99 old PNGs belonged to merged PRs or closed issues and were deleted; the
`.html`/`.md` files are kept because other docs link them (e.g. `mockups/semantic-zoom/README.md`).
