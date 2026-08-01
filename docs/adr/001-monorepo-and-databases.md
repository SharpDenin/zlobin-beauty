# ADR-001: Monorepo with service-owned databases

## Status

Accepted

## Context

Greenfield beauty platform with multiple bounded contexts and a requirement for microservice ownership of data.

## Decision

Keep a single Git monorepo. Each service owns its schema via migrations and a dedicated PostgreSQL database on a shared Postgres instance in local/dev. Services communicate over HTTP and NATS; they never read each other's tables.

## Consequences

Simpler local development and atomic cross-cutting refactors. Requires disciplined API/event contracts and eventual consistency for cross-service reads.
