<!-- pipeline-plan:v1 -->
> 🤖 **pi.dev harness** · agent pipeline (CI) · _plan run_

### Reproduced
no. Did not run it, reasoned from the code.
### Cause
The cache keys probably go stale, so it should help to refresh keys after save.
### Fix
Call refreshNuxtData with the keys after every save.
### Files
- packages/crouton-core/app/composables/useSave.ts
### Test
- [ ] T1 — keys refresh after a team switch — Run: `node --test useList.test.ts`
### Assumptions
- refreshing is enough — Why: seems right — Evidence: not checked — Status: unverified
### Needs owner
no
