// owner.mjs — ONE answer to "is this comment from the owner?" (#4168).
//
// The owner is a LOGIN (`vars.PIPELINE_OWNER`, default `pmcp`), not a role. A comment's
// `author_association` depends on the token that reads it — the owner's own replies arrive as
// COLLABORATOR under the workflow token — so a role set let the router and the Decisions writer
// disagree, and let anyone's `ok` resume a held issue. The merge gate already checks by login
// (owner-merge-go.mjs); everything else now uses this. Pure, Node core only.

export const DEFAULT_OWNER = 'pmcp'

/**
 * True when the comment's author is the owner's own (non-Bot) account. `owner` falls back to
 * `pmcp` when empty — `process.env.OWNER_LOGIN` may be `''`, which a default parameter would keep.
 * @param {{userLogin?: string, userType?: string}} [who]
 * @param {string} [owner]
 */
export function isOwner({ userLogin, userType } = {}, owner) {
  const o = String(owner || DEFAULT_OWNER).toLowerCase()
  return userType !== 'Bot' && typeof userLogin === 'string' && userLogin.toLowerCase() === o
}
