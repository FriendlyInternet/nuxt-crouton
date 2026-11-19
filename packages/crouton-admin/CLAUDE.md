# CLAUDE.md - @crouton/admin

## Package Purpose

Admin dashboard for Nuxt applications using crouton-auth. Provides two tiers of administration:

1. **Team Admin** (`/admin/[team]/*`) - Team-specific management for team admins/owners
2. **Super Admin** (`/super-admin/*`) - System-wide management for app owners

Requires `@crouton/auth` as a peer dependency (uses its user/session/team tables and composables).

## Key Features

### Team Admin (new)
- **Team Dashboard**: Overview with quick navigation for team admins
- **Member Management**: View, invite, and manage team members
- **Invitation Management**: View and cancel pending invitations
- **Team Settings**: Update team name, slug, logo, and delete team

### Super Admin
- **User Management**: List, create, ban, unban, delete users
- **Team Oversight**: View all teams/organizations and their members
- **Impersonation**: Debug as any user with visual indicator
- **Dashboard Stats**: User counts, signups, activity metrics
- **Super Admin Middleware**: Route protection for admin pages

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer configuration |
| `types/admin.ts` | Type definitions for admin features |
| `app/middleware/super-admin.ts` | Route protection for super admin pages |
| `app/middleware/team-admin.ts` | Route protection for team admin pages |
| `server/utils/admin.ts` | Server-side admin utilities |

### Composables
| File | Purpose |
|------|---------|
| `app/composables/useAdminUsers.ts` | User management composable |
| `app/composables/useAdminTeams.ts` | Team management composable |
| `app/composables/useAdminStats.ts` | Dashboard statistics composable |
| `app/composables/useImpersonation.ts` | Impersonation composable |

## Composables

| Composable | Purpose |
|------------|---------|
| `useAdminUsers()` | User CRUD operations (list, create, ban, unban, delete) |
| `useAdminTeams()` | Team listing and member viewing |
| `useAdminStats()` | Dashboard statistics |
| `useImpersonation()` | Start/stop user impersonation |
| `useAdmin()` | Barrel export for all admin composables |

## Components

### Dashboard Components
- `Admin/Dashboard.vue` - Overview with stats cards
- `Admin/StatsCard.vue` - Individual KPI card with trend
- `Admin/RecentActivity.vue` - Activity feed

### User Management Components
- `Admin/UserList.vue` - Paginated user table with search
- `Admin/UserActions.vue` - Dropdown menu (ban, delete, impersonate)
- `Admin/UserBanForm.vue` - Ban form with reason and duration
- `Admin/UserCreateForm.vue` - Create user form

### Team Components
- `Admin/TeamList.vue` - Team table with member counts
- `Admin/TeamMembers.vue` - View team members

### Global Components
- `ImpersonationBanner.vue` - Top banner when impersonating a user

## Pages

### Team Admin Pages (new)

| Page | Purpose |
|------|---------|
| `/admin/[team]` | Team admin dashboard |
| `/admin/[team]/members` | Team member management |
| `/admin/[team]/invitations` | Pending invitations management |
| `/admin/[team]/settings` | Team settings (name, slug, logo, delete) |

### Super Admin Pages

| Page | Purpose |
|------|---------|
| `/super-admin` | Dashboard with stats overview |
| `/super-admin/users` | User management page |
| `/super-admin/teams` | Team oversight page |

## Middleware

### team-admin (new)

Protects routes that require team admin or owner privileges for a specific team.

```vue
<script setup lang="ts">
definePageMeta({
  middleware: 'team-admin'
})
</script>
```

**What it checks:**
1. User is authenticated
2. User is a member of the team in the route param `[team]`
3. User has `admin` or `owner` role in that team

### super-admin

Protects routes that require super admin privileges.

```vue
<script setup lang="ts">
definePageMeta({
  middleware: 'super-admin'
})
</script>
```

## Server Utilities

### requireSuperAdmin(event)

Server-side authorization check. Throws 403 if user is not a super admin.

```typescript
import { requireSuperAdmin } from '#crouton/admin'

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event)
  // admin is the authenticated super admin user
})
```

## API Endpoints

### Users

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/users` | List users with pagination |
| GET | `/api/admin/users/[id]` | Get user details |
| POST | `/api/admin/users/create` | Create new user |
| POST | `/api/admin/users/ban` | Ban a user |
| POST | `/api/admin/users/unban` | Unban a user |
| DELETE | `/api/admin/users/delete` | Delete a user |

### Teams

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/teams` | List teams with pagination |
| GET | `/api/admin/teams/[id]` | Get team details with members |

### Impersonation

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/admin/impersonate/start` | Start impersonating a user |
| POST | `/api/admin/impersonate/stop` | Stop impersonation |

### Stats

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/stats` | Get dashboard statistics |

## Database Schema Extensions

The package extends the crouton-auth schema with these fields:

### User Table
| Field | Type | Description |
|-------|------|-------------|
| `superAdmin` | boolean | Whether user has super admin privileges |
| `banned` | boolean | Whether user is banned |
| `bannedReason` | text | Reason for the ban |
| `bannedUntil` | timestamp | When ban expires (null = permanent) |

### Session Table
| Field | Type | Description |
|-------|------|-------------|
| `impersonatingFrom` | text | Original admin ID when impersonating |

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/admin'],

  runtimeConfig: {
    public: {
      crouton: {
        admin: {
          // Super admin page route prefix (default: /super-admin)
          routePrefix: '/super-admin',
          // Enable impersonation feature
          impersonation: true,
          // Dashboard stats refresh interval (ms)
          statsRefreshInterval: 30000
        }
      }
    }
  }
})
```

## Common Tasks

### Make a user super admin

```typescript
// In a migration or seed script
import { db } from '@crouton/auth'
import { user } from '@crouton/auth/server/database/schema/auth'
import { eq } from 'drizzle-orm'

await db.update(user)
  .set({ superAdmin: true })
  .where(eq(user.email, 'admin@example.com'))
```

### Add admin pages to your app

1. Add the layer to your nuxt.config.ts:
   ```typescript
   export default defineNuxtConfig({
     extends: ['@crouton/admin']
   })
   ```

2. Pages are automatically available:
   - Team admin: `/admin/[team]/*`
   - Super admin: `/super-admin/*`

3. Customize by creating your own pages that override the defaults

### Customize impersonation banner

Create your own `ImpersonationBanner.vue` component in your app to override the default.

## Types

### AdminUser
Extended user type with admin fields.

### BanPayload
```typescript
interface BanPayload {
  userId: string
  reason: string
  duration: number | null // hours, null = permanent
}
```

### AdminStats
```typescript
interface AdminStats {
  totalUsers: number
  newUsersToday: number
  newUsersWeek: number
  bannedUsers: number
  totalTeams: number
  newTeamsWeek: number
  activeSessions: number
  superAdminCount: number
}
```

## Route Structure

```
/super-admin/                   # SUPER ADMIN (app owner only)
├── index                       # System dashboard
├── users                       # All users management
└── teams                       # All teams management

/admin/[team]/                  # TEAM ADMIN (team admins/owners)
├── index                       # Team admin dashboard
├── members                     # Team member management
├── invitations                 # Pending invitations
└── settings                    # Team settings
```

## Dependencies

- **Requires**: `@fyit/crouton-auth` (peer dependency)
- **Uses from auth**: `useTeam()`, `useSession()`, Team* components
- **Works with**: Any Nuxt UI 4 app

## Testing

```bash
pnpm typecheck && pnpm typecheck:packages  # from the repo root; see root CLAUDE.md "Post-change checks"
```

## Naming Conventions

```
Component: AdminDashboard, AdminUserList, ImpersonationBanner
Composable: useAdminUsers, useAdminTeams, useImpersonation
API: /api/admin/users, /api/admin/teams, /api/admin/impersonate/*
Middleware: super-admin, team-admin
Page: /super-admin/* (super), /admin/[team]/* (team)
```
