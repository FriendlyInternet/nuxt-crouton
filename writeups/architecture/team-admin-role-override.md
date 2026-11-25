# Can a team owner change what "admin" may do in that team?

Research for #4116 (epic #4103). No product code. Checked against `better-auth@1.7.7`, the copy
`packages/crouton-auth` resolves (both installed 1.7.7 copies have identical organization files).
Paths below are relative to `node_modules/better-auth/dist/plugins/organization/` unless noted.

## 👤 In short

**Yes, it can be done, but not the way it looks first.** Better Auth refuses a team role named
"admin" while "admin" is defined in code, and a stored team role can only ever *add* rights to a
code role, never take them away. So "the owner removes domains from admin" can't be done on top of
today's plan.

**What works (recommended, option C):** stop defining "admin" in code. Instead, every team gets its
own "admin" role row when it is created, filled with today's admin rights. The owner then edits it
in the Rôles screen like any other role. The throwaway check shows it: the owner of team A removed
"domains" from admin, and **admins in team A lost domains while admins in team B kept them.**
Better Auth's own buttons (invite, change a member's role) follow the edited role on their own.

**What it costs:**
- Every team that exists today needs its "admin" row added once, when this ships. Without it, the
  admins of that team can do nothing at all (it fails closed, not open).
- crouton creates teams in three places without going through Better Auth. All three must add the row.
- Better Auth lets *anyone* who may edit roles also edit "admin" and delete it. crouton must add
  "only the owner edits admin, and nobody deletes it".
- When a package adds a new action later, existing teams' admins don't get it on their own. A small
  sync step has to add it (open question 2).

**Owner stays safe in every option:** "owner" stays in code, can't be edited or deleted, and Better
Auth already refuses to remove or demote the last owner. Since the owner always has `team:manage`,
no team can end up with nobody able to manage it, even if admin loses everything.

### Questions for the owner
1. **Go with option C** (admin becomes a per-team role the owner edits)? yes/no
2. When a package adds a new action later, should **existing** teams' admins get it automatically
   (recommended: yes, unless that team's owner had removed it), or only new teams?
3. Should admins see their own (edited) role in the Rôles screen as read-only? (recommended: yes)

---

## 🤖 Evidence

Throwaway check: [`team-admin-role-override.check.mjs`](./team-admin-role-override.check.mjs). It
runs the real installed Better Auth on an in-memory database. Real sign-ups and sessions, real
`createOrganization`, `create-role`, `update-role`, `delete-role`, `update-member-role`,
`create-invitation` and `has-permission` endpoints. Run `node writeups/architecture/team-admin-role-override.check.mjs`.
Output on 2026-11-18: **16/16 expectations held** (A1–A2, C0–C15, quoted below).

### Q1. Can a team override a built-in role?

**No, not while the role is in code.**

- `create-role` calls `checkIfRoleNameIsTakenByPreDefinedRole` (`routes/crud-access-control.mjs:52`),
  which refuses any name in `Object.keys(options.roles)` (falling back to owner/admin/member) with
  `ROLE_NAME_IS_ALREADY_TAKEN` (`:636-650`). `update-role` runs the same check when renaming (`:550`).
  Check **A1**: the owner creating `admin` → `ROLE_NAME_IS_ALREADY_TAKEN`.
- **Stored rows only add.** `hasPermission` starts from `options.roles` (`has-permission.mjs:8`) and,
  for each stored row, *unions* its actions into the code role of the same name
  (`has-permission.mjs:24-26`: `merged[key] = [...new Set([...merged[key] ?? [], ...actions])]`).
  Check **A2**: a row named `admin` with no crouton actions, inserted directly (bypassing the
  endpoint), still leaves admin with `team:domains`. Nothing can be removed.
- **But the name is only "built-in" if it is in `options.roles`.** When `options.roles` is given,
  only its keys are protected (`:637`, same for delete `:201`). Leave `admin` out and a team may store
  a row named `admin`. That row is then the *whole* admin role: `acRoles.admin` is undefined, so the
  merge starts empty (`has-permission.mjs:24`). Assignment still works: `update-member-role` and
  invites always accept Better Auth's default names (`routes/crud-members.mjs:311`,
  `routes/crud-invites.mjs:104-106`). This is what option C uses.

### Q2. Options

| | What | Works with BA 1.7.7? | Cost |
|---|---|---|---|
| **a** | Team row named `admin` on top of the code role | ❌ refused (A1), and could only add (A2) | — |
| **b** | crouton table "per team, admin minus these actions", read by `can()` (#4104) | ⚠️ `can()` only. Better Auth's endpoints still use the code admin role. | crouton must block BA endpoints itself. There are org hooks for invite / member role / remove member (`beforeCreateInvitation` `routes/crud-invites.mjs:207`, `beforeUpdateMemberRole` `routes/crud-members.mjs:340`, `beforeRemoveMember` `:213`). There are **none** for create/update/delete role, so those need a global `hooks.before` on the path (`api/dispatch.mjs:141`). `/organization/has-permission` would also give a different answer than `can()`. Two sources of truth. |
| **c** ✅ | `admin` left out of `options.roles`. Each team gets an `admin` row (today's admin rights) when created. The owner edits it. | ✅ C0–C15 | Backfill existing teams. Seed on every team-creation path. Guard "owner only, never delete". Keep rows in sync when actions are added (below). |
| d | Anything else in the library | Nothing found. No per-organization `roles`, and no hook on role CRUD or on `hasPermission`. | — |

Option C, from the check:
- **C2–C6**: owner of A updates A's `admin` row without `team:domains` → admin in A: `team:domains`
  false, `pages:edit` true. Admin in B: still true. Owner of A: still true.
- **C7**: admin of A tries to add `team:domains` back → `YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE`.
  Better Auth refuses to grant rights the editor doesn't have (`checkIfMemberHasPermission`,
  `routes/crud-access-control.mjs:598-635`).
- **C8**: but admin of A *can* shrink the admin role. Better Auth only asks for `ac: ["update"]`
  (`:484-491`). "Only the owner edits admin" is a crouton rule (Q5).

### Q3. Better Auth's own permissions under C

- Invite needs `invitation: ["create"]` (`routes/crud-invites.mjs:95-100`). Changing a role needs
  `member: ["update"]` (`routes/crud-members.mjs:303-309`). Creating, editing or deleting roles needs
  `ac: [...]` (`routes/crud-access-control.mjs:79-90, 186-197, 484-491`). Under C these come from the
  team's admin row. The seed row is `adminAc.statements` (`access/statement.mjs:24-43`) plus
  crouton's admin actions, so on day one nothing changes.
- **C9**: with `member:update` stored, admin of A changes a member's role. **C10/C11**: the owner
  removes `team:manage` and, with it, Better Auth's `member`, `invitation` and `ac` actions → admin of
  A gets `YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION`, admin of B still invites.
- So #4106's rule ("ticking `team:manage` also stores Better Auth's member / invitation / ac
  actions, unticking removes them") carries over unchanged. The admin row is just one more row the
  screen writes that way.

### Q4. Lock-out

- **Owner**: stays in `options.roles` with every right. No row can be created with that name
  (`:637-648`). `update-role` only edits stored rows, so there is nothing to edit. Better Auth refuses
  to remove, demote or let the last owner leave (`routes/crud-members.mjs:194-199, 286-302, 419-427`).
  Check **C15**: the owner keeps `team:manage` and `member:update` whatever admin's row says.
  Rule D (#4103) holds.
- **Removing `team:manage` from admin**: allowed, and it works (C10). The team can still be managed
  because there is always at least one owner, and the owner always has `team:manage`.
- **What Better Auth does *not* stop (crouton must)**:
  - **C12**: deleting the `admin` row once no member holds it succeeds. Better Auth only refuses
    deleting a role someone holds (`routes/crud-access-control.mjs:250-269`), and `admin` is no
    longer pre-defined.
  - **C13/C14**: `admin` then stays assignable, and that admin can do nothing. This fails closed,
    so it is safe but confusing. crouton must refuse deleting `admin`.
  - A team with **no** admin row (created before this ships, or by one of the raw-SQL paths below)
    is in the same state, so every one of its admins can do nothing until the row exists.

### Q5. Where it plugs in

- **#4104 (`can()`, base roles)**: `options.roles` gets `owner` and `member` only. The config's
  `admin` entry becomes the *template* for the seed row, not a live role. `can()` is unchanged: it
  already calls `hasPermission` with a context so stored rows load (`has-permission.mjs:9`).
- **Seeding**: one helper, e.g. `ensureTeamAdminRole(db, orgId)`, called from Better Auth's
  `afterCreateOrganization` (crouton's is `packages/crouton-auth/server/lib/auth.ts:1324`) **and**
  from the three raw-SQL team inserts that skip Better Auth's hooks:
  `ensureDefaultOrgExists` (`packages/crouton-auth/server/lib/auth.ts:603`, insert `:616`),
  `createPersonalOrg` (`:685`, insert `:704`) and `getOrCreateDefaultOrganization`
  (`packages/crouton-auth/server/utils/team.ts:296`, insert `:317`). Plus a one-time backfill of
  every existing team in every app with a `member` table. #4106 already lists the 13 apps for the
  `organizationRole` migration, so the backfill can ride that migration as an `INSERT … SELECT`.
- **Keeping rows current (open question 2)**: store what the owner *removed* next to the row (the
  role table accepts extra fields: `schema.organizationRole.additionalFields`, `organization.mjs:700`).
  A sync step can then rebuild every admin row as "config admin defaults minus what this team
  removed". New package actions then reach existing teams, and owners' choices survive.
- **Guard "owner only, never delete"**: a global `hooks.before` (`api/dispatch.mjs:141`) on
  `/organization/update-role` and `/organization/delete-role`. If the target row is `admin` (by
  `roleName` or by `roleId`; delete-by-id skips Better Auth's name check, `:198-213`), require the
  caller's role to include `owner` for update, and refuse delete always. Renaming another role *to*
  `admin` must be refused too, since `checkIfRoleNameIsTakenByRoleInDB` (`:651-671`) only refuses it
  while the admin row exists.
- **Rôles screen (#4106)**: `list-roles` returns the admin row with the team's other roles
  (`routes/crud-access-control.mjs:286`). The screen shows **owner, member: read-only · admin:
  editable by the owner only (read-only for everyone else) · custom roles**. Rule B of #4103 changes
  from "base roles can't be edited" to "owner and member can't be edited; admin only by the owner;
  none can be deleted".
- Side note: `checkIfMemberHasPermission` uses a process-wide cache (`permission.mjs:12`,
  `useMemoryCache: true`), filled by the full load just before (`:79-90`). So an edit is seen on the
  next request. No staleness found.

## Considered & rejected

- a (row named `admin` on top of code) → ❌ Better Auth refuses the name, and rows can only add (A1, A2).
- b (crouton-side deny list) → ❌ Better Auth's endpoints and `has-permission` would keep the old
  admin rights unless crouton blocks each one. There is no org hook for role CRUD. Two sources of truth.
- Patching Better Auth (subtracting in `has-permission.mjs`) → ❌ a fork to carry on every upgrade.

## Not in this write-up

Building option C. That is a follow-up ticket once the owner answers the questions above.
