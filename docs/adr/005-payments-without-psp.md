# ADR-005: Payments without online PSP

## Status

Accepted

## Context

Online card acquiring is not configured yet; fake payment gateways are forbidden.

## Decision

Support only: cash on delivery / at visit, bank invoice transfer, and manual confirmation by authorized staff. Online PSP integration is deferred; UI does not offer card checkout until a real provider is wired.

## Consequences

Orders and appointments can progress without simulated charges. Accounting of “paid” is an explicit authorized action.
