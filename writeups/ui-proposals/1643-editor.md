# #1643 — slim handleSubmit: visual evidence

`Workspace/Editor.vue`'s `handleSubmit` and inline arrow handlers were refactored.
Behaviour-preserving, so the acceptance question is: **does the editor still render
and behave the same?**

| | |
|---|---|
| Before (`main` @ `00d4b3683`) | `1643-editor-before.png` |
| After (`work-1643` @ `16565bc50`) | `1643-editor-after.png` |

## What the comparison does and does not show

The **SEO tab is byte-identical** across main and this branch — and byte-stable
across repeated runs, so that identity is meaningful.

The **editor Settings view is not byte-comparable**. Two captures of the *same*
branch differ by 212 bytes; main vs this branch differ by 259 bytes. The
cross-branch delta is the same order as the same-branch delta, so it is
**indistinguishable from capture noise** — something on that view renders
non-deterministically. Read the two images side by side; do not read the byte
delta as a finding either way.

This is stated rather than glossed because the honest limit of the evidence is
part of the evidence. A byte-identity claim is only worth something on a surface
that is byte-stable, which is why the same-branch control was run first.

## Not covered

`handleSubmit` is a **save** path. These are static renders — they show the
editor still draws, not that saving still works. Exercising Save is the gap;
CI's 30/30 green and the unchanged template are the only evidence on that half.

## How they were captured

`pnpm preview velo` (real session, seeded `test1`) → Pages Workspace → page
`Welkom` → editor, 1440x950 @2x. Session cookies injected rather than driving the
login form, and the wait is on the seeded page's own name — driving the form
races Nuxt's first-hit compile and waiting for "some element" shoots a skeleton,
both of which write a plausible blank PNG (#2045).
