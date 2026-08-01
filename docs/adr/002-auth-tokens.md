# ADR-002: Authentication tokens

## Status

Accepted

## Context

Need secure multi-device sessions with revoke and rotation for a production system.

## Decision

- Access token: JWT, HS256 (dev) / asymmetric keys later, TTL 15 minutes, claims: `sub`, `sid`, `roles`, `exp`, `iat`, `jti`.
- Refresh token: opaque random 32+ bytes, stored as SHA-256 hash, TTL 30 days, rotated on every refresh (reuse of old token revokes the session family).
- Passwords: Argon2id.
- Login rate limit: per IP + per account.

## Consequences

Gateway and services verify access JWTs with a shared secret/key material from env. Refresh endpoint lives only on identity service.
