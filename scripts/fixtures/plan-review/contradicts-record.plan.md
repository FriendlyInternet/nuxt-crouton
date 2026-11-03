<!-- pipeline-plan:v1 -->
> 🤖 **pi.dev harness** · agent pipeline (CI) · _plan run_

### Reproduced
yes. Booted the app; the package Card component wins over the app's own Card.
### Cause
Layer component dirs tie with the app dir, see https://github.com/FriendlyInternet/nuxt-crouton/blob/abc123/nuxt.config.ts#L30. First bad commit 1a2b3c4 added the package dir.
### Fix
Set `priority: -1` on the package component dirs.
### Files
- packages/crouton-core/nuxt.config.ts
### Test
components.test.ts: app Card beats the package Card; package Card still wins over the Nuxt UI one.
### Assumptions
- only crouton-core registers component dirs — Why: grep shows one config — Evidence: https://github.com/FriendlyInternet/nuxt-crouton/blob/abc123/nuxt.config.ts#L30 — Status: verified
### Needs owner
no, a mechanical fix.
