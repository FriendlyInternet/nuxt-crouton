# @crouton/auth Database Migration Guide

This guide explains how to set up and migrate the database schema for @crouton/auth.

## Overview

@crouton/auth uses [Drizzle ORM](https://orm.drizzle.team/) for database operations. The schema is pre-defined and includes all tables required by Better Auth and its plugins:

**Core Tables:**
- `user` - User identity and profile
- `session` - User sessions with organization context
- `account` - OAuth and credential accounts
- `verification` - Email verification and password reset tokens
- `rateLimit` - Rate-limit counters (better-auth database store)

**Organization Plugin Tables:**
- `organization` - Teams/workspaces
- `member` - Organization membership
- `invitation` - Pending invitations

**Plugin Tables:**
- `passkey` - WebAuthn credentials (Passkey Plugin)
- `twoFactor` - 2FA configuration (Two-Factor Plugin)
- `subscription` - Stripe subscriptions (Stripe Plugin)

## NuxtHub (Cloudflare D1) - Recommended

NuxtHub automatically handles database migrations. This is the recommended approach for @crouton/auth.

### Fresh Install

1. **Export the auth schema in your project:**

```typescript
// server/database/schema/index.ts
export * from '@crouton/auth/server/database/schema/auth'
// ... your other schemas
```

2. **Generate migrations with Drizzle Kit:**

```bash
# Generate migration SQL files
npx drizzle-kit generate

# Preview the migration
npx drizzle-kit push --dry-run
```

3. **Apply migrations:**

For local development:
```bash
# Start dev server (local migrations applied automatically)
npx nuxt dev
```

For production:
```bash
# Apply migrations to remote D1 database
npx wrangler d1 migrations apply DB --remote
# Then deploy via CI or manually
npx wrangler pages deploy dist/
```

### Upgrading from Existing Schema

If you're adding @crouton/auth to an existing project:

1. **Check for conflicts with existing tables:**

The auth schema uses these table names:
- `user`, `session`, `account`, `verification`
- `organization`, `member`, `invitation`
- `passkey`, `twoFactor`, `subscription`

If you have existing tables with these names, you'll need to rename them before adding @crouton/auth.

2. **Generate incremental migration:**

```bash
# Generate migration that adds only new tables/columns
npx drizzle-kit generate

# Review the generated SQL
cat server/database/migrations/XXXX_*.sql
```

3. **Apply the migration:**

```bash
# For local: restart dev server
npx nuxt dev

# For production: apply migration and redeploy
npx wrangler d1 migrations apply DB --remote
npx wrangler pages deploy dist/
```

## Better Auth CLI (Alternative)

If you're using Better Auth's built-in Kysely adapter instead of Drizzle, you can use the Better Auth CLI:

```bash
# Generate and apply schema
npx @better-auth/cli@latest migrate

# With confirmation skip
npx @better-auth/cli@latest migrate --yes

# Specify config file
npx @better-auth/cli@latest migrate --config ./auth.config.ts
```

**Note:** This is NOT recommended when using @crouton/auth with Drizzle adapter. Use Drizzle Kit instead.

## Manual SQL (Advanced)

For manual database management, you can generate the SQL schema:

```bash
# Generate SQL schema file
npx drizzle-kit generate --out ./sql

# Apply to D1 directly (local)
npx wrangler d1 execute DB_NAME --local --file=./sql/0000_*.sql

# Apply to D1 directly (production)
npx wrangler d1 execute DB_NAME --file=./sql/0000_*.sql
```

## Migration Helper Script

@crouton/auth provides a migration helper script for common operations:

```bash
# Check current schema status
npx crouton-auth migrate:status

# Generate migrations
npx crouton-auth migrate:generate

# Apply migrations (local)
npx crouton-auth migrate:push

# Reset database (development only!)
npx crouton-auth migrate:reset
```

See `scripts/migrate.ts` for implementation details.

## Schema Extensions

@crouton/auth extends the base Better Auth schema with mode-specific columns:

### Organization Table Extensions

```sql
-- Mode-specific flags
personal BOOLEAN DEFAULT false,    -- Personal workspace marker
isDefault BOOLEAN DEFAULT false,   -- Single-tenant default org
ownerId TEXT,                      -- Personal workspace owner

-- Indexes for efficient queries
CREATE INDEX organization_owner_idx ON organization(ownerId);
CREATE INDEX organization_default_idx ON organization(isDefault);
CREATE INDEX organization_personal_idx ON organization(personal);
```

### Session Table Extensions

```sql
-- Organization context
activeOrganizationId TEXT,         -- Current active team

CREATE INDEX session_active_org_idx ON session(activeOrganizationId);
```

### User Table Extensions

```sql
-- Stripe integration
stripeCustomerId TEXT,

CREATE INDEX user_stripe_customer_idx ON user(stripeCustomerId);
```

## Troubleshooting

### "Table already exists" Error

If you get this error, you likely have conflicting tables. Options:

1. **Rename existing tables** before adding @crouton/auth
2. **Use custom table names** (not yet supported, coming in future release)
3. **Migrate data** to new table structure manually

### Migration Not Applied

For Cloudflare deployments:

1. Check that schema is exported correctly
2. Verify `drizzle.config.ts` points to correct schema directory
3. Ensure migrations are generated: `npx drizzle-kit generate`
4. Apply migrations: `npx wrangler d1 migrations apply DB --remote`
5. Check Cloudflare dashboard logs for errors

### Type Errors After Migration

Run `npx nuxt prepare` to regenerate types after schema changes:

```bash
npx nuxt prepare
npx nuxt typecheck
```

## Environment Requirements

- **Node.js**: 18.x or later
- **pnpm/npm/yarn**: Latest version recommended
- **Drizzle Kit**: ^0.20.0 (dev dependency)
- **NuxtHub**: Required for D1 database support

## Related Documentation

- [Better Auth Database Concepts](https://www.better-auth.com/docs/concepts/database)
- [Better Auth Drizzle Adapter](https://www.better-auth.com/docs/adapters/drizzle)
- [Drizzle Kit Migrations](https://orm.drizzle.team/kit-docs/overview)
- [NuxtHub Database](https://hub.nuxt.com/docs/features/database)
