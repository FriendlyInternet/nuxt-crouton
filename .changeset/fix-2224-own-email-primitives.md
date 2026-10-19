---
"@fyit/crouton-email": patch
---

Drop `vue-email` (unmaintained; `module-from-string` high advisory with no fix, plus a
DOMPurify tail). The ten primitives the templates use now live in
`server/emails/primitives.ts` and emit the same markup; rendering uses Vue's own
`vue/server-renderer` plus `html-to-text` for the plain-text part. Every transactional
template renders byte-for-byte as before (snapshot-tested). Fixes #2224.
