# Security Guide

This document details the security measures implemented in @crouton/auth and provides guidance for secure deployment.

## Security Architecture

@crouton/auth builds on Better Auth's security foundation while adding team-scoped access control.

### Session Security

**Cookie Configuration:**
```typescript
{
  cookieName: 'better-auth.session_token',
  sameSite: 'lax',  // Prevents CSRF in cross-site contexts
  secure: true,     // HTTPS only in production
  httpOnly: true,   // Prevents JavaScript access
}
```

**Session Management:**
- Sessions use cryptographically secure random tokens
- Session tokens are hashed before storage (SHA-256)
- Default expiry: 7 days (configurable)
- Automatic session refresh on activity
- A password reset signs out every session (`revokeSessionsOnPasswordReset`)

### CSRF Protection

**Built-in Protection:**
- `sameSite: 'lax'` cookies prevent CSRF attacks
- Better Auth includes CSRF token validation for sensitive operations
- State parameter in OAuth flows prevents CSRF during social login

**Recommendations:**
```typescript
// Production configuration
croutonAuth: {
  session: {
    sameSite: 'strict',  // More restrictive if not using OAuth
    secure: true,
  }
}
```

### Authentication Methods

#### Password Authentication

- Passwords are hashed using Argon2id (memory-hard, resistant to GPU attacks)
- Minimum password length: 8 characters (configurable)
- When `@fyit/crouton-email` is installed, sign-up sends a verification e-mail and password sign-in is refused until it is clicked; apps without it sign up as before
- Password reset tokens expire after 1 hour
- Account lockout after failed attempts (configurable)

**Best Practices:**
```typescript
croutonAuth: {
  methods: {
    password: {
      minLength: 12,        // Stronger passwords
      requireNumbers: true,
      requireSpecial: true,
    }
  }
}
```

#### OAuth/Social Login

- State parameter validates request origin
- Access tokens are encrypted before storage
- Refresh tokens stored securely for offline access
- Provider-specific scopes are minimized

**Supported Providers:**
- Google (with offline access for refresh tokens)
- GitHub (with `user:email` scope)
- Discord

#### Passkeys/WebAuthn

- Public key cryptography (no shared secrets)
- Phishing-resistant (bound to origin)
- Credentials stored server-side
- Supports biometric authentication

**Configuration:**
```typescript
croutonAuth: {
  methods: {
    passkeys: {
      rpId: 'example.com',       // Your domain
      rpName: 'My App',          // Display name
      userVerification: 'preferred',
    }
  }
}
```

#### Two-Factor Authentication

- TOTP (Time-based One-Time Passwords)
- 6-digit codes, 30-second period
- Backup codes for recovery (10 codes, single-use)
- Trusted device option

### Team Access Control

**Role-Based Access:**
```typescript
type MemberRole = 'owner' | 'admin' | 'member'

// Permission hierarchy
owner  > admin > member
```

**Server-Side Validation:**
```typescript
// Always validate on server
const { team, user, membership } = await resolveTeamAndCheckMembership(event)

// Role checks
await requireTeamAdmin(event)  // Admin or owner
await requireTeamOwner(event)  // Owner only
```

**Query Scoping:**
```typescript
// All queries MUST include teamId
const items = await db.query.items.findMany({
  where: eq(items.teamId, team.id)  // REQUIRED
})
```

### Input Validation

**Server-Side:**
- All inputs validated with Zod schemas
- Email format validation
- Password strength requirements
- Team name/slug validation

**Example:**
```typescript
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100),
})

const body = await readValidatedBody(event, schema.parse)
```

### Rate Limiting

Better Auth includes built-in rate limiting:

| Endpoint | Limit | Window |
|----------|-------|--------|
| Sign-in, sign-up, change password/email | 3 | 10 seconds |
| Password reset, verification email, email OTP | 3 | 60 seconds |
| Every other auth endpoint | 100 | 10 seconds |

Counted per client IP (`cf-connecting-ip`) in the `rateLimit` D1 table, shared by every Worker instance; requests without that header and the page-load reads `/get-session`, `/organization/get-full-organization`, `/organization/list` are not counted.

**Recommended Additional Protection:**
```typescript
// Add IP-based rate limiting at the edge
// Using Cloudflare, Vercel, or nginx
```

### Data Protection

**Encryption:**
- OAuth tokens encrypted at rest (AES-256)
- Session tokens hashed (SHA-256)
- 2FA secrets encrypted

**Database:**
- Use encrypted connections (TLS)
- Implement row-level security where possible
- Regular backups with encryption

### Environment Variables

**Required (MUST be set):**
```bash
BETTER_AUTH_SECRET=           # Min 32 chars, random
BETTER_AUTH_URL=              # Your app URL
```

**OAuth (if enabled):**
```bash
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**Billing (if enabled):**
```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

### Security Checklist

#### Development

- [ ] `BETTER_AUTH_SECRET` is random and secure (use `openssl rand -base64 32`)
- [ ] All OAuth secrets are in `.env` (not committed)
- [ ] `.env` is in `.gitignore`

#### Staging/Production

- [ ] HTTPS enforced (redirect HTTP → HTTPS)
- [ ] Secure cookies enabled (`secure: true`)
- [ ] CORS configured properly
- [ ] Rate limiting enabled
- [ ] Error messages don't leak sensitive info
- [ ] Logs don't contain passwords or tokens
- [ ] Database encrypted in transit and at rest
- [ ] Regular security updates applied

#### Code Review

- [ ] All API routes validate authentication
- [ ] All team routes validate membership
- [ ] All database queries scope by teamId
- [ ] No sensitive data in client-side code
- [ ] No hardcoded secrets
- [ ] Input validation on all user inputs

### Common Vulnerabilities

#### XSS (Cross-Site Scripting)

**Prevention:**
- Vue.js auto-escapes template expressions
- Use `v-text` instead of `v-html`
- Sanitize any HTML content

#### SQL Injection

**Prevention:**
- Drizzle ORM uses parameterized queries
- Never concatenate user input into queries

#### IDOR (Insecure Direct Object Reference)

**Prevention:**
- Always validate team membership
- Check ownership before updates/deletes
```typescript
// Bad: Direct ID access
const item = await db.query.items.findFirst({
  where: eq(items.id, params.id)
})

// Good: Scoped to team
const item = await db.query.items.findFirst({
  where: and(
    eq(items.id, params.id),
    eq(items.teamId, team.id)  // REQUIRED
  )
})
```

#### Session Fixation

**Prevention:**
- Better Auth regenerates session on login
- Sessions tied to user identity

### Reporting Vulnerabilities

If you discover a security vulnerability:

1. **Do NOT** open a public issue
2. Email security concerns privately
3. Allow time for a fix before disclosure
4. Responsible disclosure appreciated

### Updates

Keep dependencies updated:

```bash
# Check for updates
pnpm outdated

# Update Better Auth
pnpm update better-auth@latest

# Update all dependencies
pnpm update
```

### Resources

- [Better Auth Security](https://www.better-auth.com/docs/security)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
