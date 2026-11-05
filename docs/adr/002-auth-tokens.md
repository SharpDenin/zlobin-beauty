# ADR-002: Authentication tokens

## Status

Accepted

## Context

Need secure multi-device sessions with revoke and rotation for a production system.

## Decision

- Access token: JWT, HS256 (dev) / asymmetric keys later, TTL 15 minutes (`ACCESS_TOKEN_TTL`), claims: `sub`, `sid`, `roles`, `exp`, `iat`, `jti`.
- Refresh token: opaque random 32+ bytes, stored as SHA-256 hash, TTL 30 days (`REFRESH_TOKEN_TTL` default `720h`), rotated on every refresh.
- Reuse of an old refresh outside a **20s grace** after rotation revokes the session family; within grace (multi-tab) the successor session is used.
- Changing TTL env vars affects **only newly issued** tokens; existing `sessions.expires_at` is not bulk-updated or mass-revoked.
- Passwords: Argon2id.
- Login / password-reset / email-verify rate limits: per IP + per account (and gateway edge limits).
- Password reset and email verification use hashed one-time tokens in `auth_action_tokens` (see [AUTH_EMAIL_AND_SESSIONS.md](../AUTH_EMAIL_AND_SESSIONS.md)).
- Frontend: localStorage session + automatic refresh + multi-tab sync; no Remember me; no cookie migration.
- `email_verified` / `phone_verified` are soft signals — not hard-gates for login, booking, or shop. Phone SMS verification is deferred.

## Consequences

Gateway and services verify access JWTs with a shared secret/key material from env. Refresh endpoint lives only on identity service. Mail delivery is behind `shared/mailer` so SMTP provider can change without rewriting auth.
