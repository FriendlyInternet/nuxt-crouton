# #1642 — Settings tab extraction: visual evidence

| | |
|---|---|
| Before (`main` @ `00d4b3683`) | `1642-settings-before.png` |
| After (`work-1642`, padding fixed) | `1642-settings-after.png` |

**446 differing pixels — 0.008% of the viewport.** The same-branch noise floor,
measured by shooting the identical branch three times, is 979 px, so this is below
the level at which the capture itself is repeatable. Pixel parity.

## The regression this caught

The first capture of this branch differed from main by **259,267 px (4.74%)**,
spanning almost the full page height. The content was identical — it was *shifted
16px down and right*, because the layout classes were applied twice:

- `Editor.vue` wrapped the tab in `mx-auto w-full max-w-3xl px-4 py-4`
- the extracted `SettingsTab.vue` root repeats those same classes

The sibling extraction (`SeoTab.vue`, #1641) got this right — its wrapper in
`Editor.vue` is bare `<div v-show="activeTab === 'seo'">` and the component owns
its layout. This now matches.

## Why bytes were not enough

File size could not settle it. Same-branch runs varied by 420 bytes; the
cross-branch delta was 580–1000 bytes — overlapping ranges. Only a pixel diff
separated "noise" from "everything moved 16px". A byte comparison would have
shrugged at a visible regression, and a single before/after glance would likely
have missed a uniform 16px shift too.

## How they were captured

`pnpm preview velo` (real session, seeded `test1`) → Pages Workspace → page
`Welkom` → the editor's default **Settings** tab, 1440x950 @2x. Session cookies
injected rather than driving the login form, and the wait is on the seeded page's
own name — both avoid capturing a blank or skeleton page (#2045).
