# Mobile API v1 Compatibility Contract

The mobile protocol is part of the self-hosted backend. The iOS application remains closed-source, but users may connect it to either Curioflow Cloud or their own compatible Curioflow server.

Self-hosted servers advertise `plan: "self_hosted"` and the `ios_access` capability without consulting Cloud billing. Official Curioflow Cloud applies its private subscription entitlement before serving product/data operations.

All supported native clients use the `/api/mobile/v1` prefix. The unversioned `/api/mobile` routes remain compatibility aliases during migration and must not gain fields or semantics that are absent from v1 fixtures.

Session responses include:

- `protocol.version`: the server protocol version;
- `protocol.minimumClientVersion`: the oldest supported app version;
- `protocol.capabilities`: additive feature identifiers that clients must treat as an open set.

Errors use `{ code, message, retryable, requestId?, details? }`. Clients may display `message`, branch on `code`, honor `Retry-After`, and must tolerate unknown codes and fields. DTO enums are open: an unknown enum value must fall back to an `unknown` presentation rather than fail the whole payload.

Mutation requests are limited to 100 combined item and annotation mutations. Every durable mutation carries `deviceId` and `clientMutationId`; acknowledgements are matched only by `clientMutationId`. Replays within the receipt-retention window return the stored result. Annotation creates use a client-generated `annotationId`, allowing later offline updates or deletes to refer to the same record before the create is acknowledged.

Canonical session and sync examples live under `test/fixtures/mobile-v1`. The identical files under the iOS repository's `ProtocolFixtures/mobile-v1` directory must decode in Swift before either side changes the contract.

PATCH-like update payloads use omission to mean unchanged. A client must not send a default for a field it does not model.
