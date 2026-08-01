# ADR-004: Appointment overlap protection

## Status

Accepted

## Context

Concurrent booking must not double-book a master.

## Decision

Store appointment intervals as `tstzrange`. Enforce exclusion constraint for rows whose status is not a terminal cancellation/no-show. Creates/reschedules run in a transaction that inserts/updates under that constraint and returns a conflict error mapped to HTTP 409.

## Consequences

Correctness guaranteed by PostgreSQL even under concurrent clients. Requires careful status filters in the constraint predicate.
