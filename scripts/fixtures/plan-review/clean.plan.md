<!-- pipeline-plan:v1 -->
> 🤖 **pi.dev harness** · agent pipeline (CI) · _plan run_

### Reproduced
yes. Booted the app, opened /admin/posts and the list rendered stale rows after save; screenshot in the run log.
### Cause
The list query key omits the team id, see https://github.com/FriendlyInternet/nuxt-crouton/blob/abc123/packages/crouton-core/app/composables/useList.ts#L12. First bad commit 1a2b3c4 added the shared key.
### Fix
Add the team id to the key.
### Files
- packages/crouton-core/app/composables/useList.ts
### Test
- [ ] T1 — two teams get separate keys — Run: `pnpm vitest run useList.test.ts`
### Assumptions
- the key is only built in useList — Why: grep shows one call site — Evidence: https://github.com/FriendlyInternet/nuxt-crouton/blob/abc123/packages/crouton-core/app/composables/useList.ts#L12 — Status: verified
### Docs
- packages/crouton-core/CLAUDE.md:42 "list keys include the team id" — Status: checked — Evidence: https://github.com/FriendlyInternet/nuxt-crouton/blob/abc1234/packages/crouton-core/app/composables/useList.ts#L12 — Regression: no — Edit: none needed
### Needs owner
no, a mechanical fix.
