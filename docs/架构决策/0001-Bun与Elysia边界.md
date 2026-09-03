# ADR 0001: Bun/Elysia and adapter boundaries

## Decision

Use Bun/Elysia for the HTTP/API layer and keep all external hospital/payment protocols behind ports and adapters.

## Reason

Elysia gives the new API a Bun-first runtime, request validation, OpenAPI and end-to-end type sharing. It does not remove the need to isolate legacy Java/FSI cryptography, provider-specific signing, retries or callback evidence.

## Consequences

- The patient client sees stable application contracts, not provider payloads.
- The first migration can keep the existing MySQL/Redis data and external services.
- Provider adapters can be tested with contract fixtures and replayed responses.
- A Java/Python sidecar may remain temporarily where Bun cannot safely replace an existing implementation.
