<!-- pipeline-plan:v1 -->
> 🤖 **pi.dev harness** · agent pipeline (CI) · _plan run_

### Reproduced
yes. Booted the app, created a row with no teamId and saw it listed for every team.
### Cause
The insert path never sets teamId, see https://github.com/FriendlyInternet/nuxt-crouton/blob/abc123/packages/crouton-core/server/utils/insert.ts#L20. First bad commit 1a2b3c4 dropped the default.
### Fix
Force teamId on rows without one.
### Files
- packages/crouton-core/server/utils/insert.ts
### Test
insert.test.ts: a row without teamId gets the current teamId.
### Assumptions
- the insert path is the only writer — Why: grep shows one call site — Evidence: https://github.com/FriendlyInternet/nuxt-crouton/blob/abc123/packages/crouton-core/server/utils/insert.ts#L20 — Status: verified
### Needs owner
no, a mechanical fix.
