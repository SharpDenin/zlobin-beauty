# ADR-003: Synchronous HTTP and JetStream events

## Status

Accepted

## Context

Need request/response for UI flows and reliable async fan-out for reporting/notifications without distributed transactions.

## Decision

- Gateway ↔ services and service ↔ service request paths: HTTP JSON.
- Domain events: NATS JetStream via transactional outbox in the producing service.
- Consumers are idempotent by `event_id`; failed messages go to a DLQ stream after limited retries.

## Consequences

Slightly higher latency than in-process calls; clearer failure domains. Outbox poller is required in each producing service.
