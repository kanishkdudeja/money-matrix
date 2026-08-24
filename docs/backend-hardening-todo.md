# Backend hardening TODO

This checklist tracks the audit work required before the initial Money Matrix backend is considered complete. Items are only checked after implementation, focused tests, and full verification.

## Integrity architecture

- [x] Route every ledger creation and classification replacement through the ledger domain service.
- [x] Make entries belonging to reversed transactions immutable at the database level.
- [x] Add a deferred database check for the final posting-to-bucket equation of every committed transaction.
- [x] Represent classification replacement as a typed command that validates totals and distinct bucket-transfer targets before writes.
- [x] Keep archived-target policy explicit: new activity requires active targets; technical reversals may reuse historical archived targets.
- [x] Ensure import and reconciliation HTTP handlers cannot perform their multi-table workflows directly.

## CSV and import workflow

- [x] Correct parsing of negative fractional amounts such as `-0.25`.
- [x] Reject malformed debit, credit, and balance values instead of silently discarding parse errors.
- [x] Check debit/credit subtraction for overflow.
- [x] Canonicalize account IDs used in row fingerprints.
- [x] Make an upload atomic so an unexpected failure cannot leave a partially applied, unretryable batch.
- [x] Derive the final batch state when upload processing finishes, including all-duplicate batches.
- [x] Add import-batch listing with useful status filters and pagination.
- [x] Prevent classification changes to reversed imported transactions.
- [x] Apply active bucket and optional-category validation during imported-row review.
- [x] Add parser, atomicity, duplicate-only, discovery, reversed-review, and archived-target tests.

## Ledger rules

- [x] Reject categorized bucket entries on `bucket_transfer` transactions.
- [x] Require at least two distinct buckets on a bucket transfer.
- [x] Permit a technical reversal to reference archived historical accounts, categories, and buckets.
- [x] Preserve the coverage equation across create, review, reversal, and archival workflows.
- [x] Add direct-database tests proving invalid committed ledger states are rejected.
- [x] Unify classification and allocation as `BucketEntry` with a required bucket and optional category, removing ambiguous correlations between independent splits.

## Reconciliation lifecycle

- [x] Serialize lifecycle changes by locking the financial account.
- [x] Allow an `in_progress` or `reopened` reconciliation to be completed later.
- [x] Allow only the latest completed reconciliation to be reopened.
- [x] Reject completing checkpoints out of statement-date order.
- [x] Maintain fixed, non-overlapping posting membership when completing or reopening.
- [x] Add complete and reopen API operations and typed OpenAPI responses.
- [x] Add lifecycle, ordering, concurrency, balance-mismatch, and membership tests.

## Catalog and currency integrity

- [x] Enforce the initial single-currency (`INR`) policy in both API validation and PostgreSQL.
- [x] Require a category parent to have the same kind as its child.
- [x] Prevent category hierarchy cycles.
- [x] Return `parentId` so clients can reconstruct the hierarchy.
- [x] Map foreign-key and check-constraint failures to useful client errors.

## HTTP and OpenAPI contract

- [x] Preserve `application/problem+json` for problem responses.
- [x] Distinguish an omitted account note from an explicit JSON `null` so notes can be cleared.
- [x] Document `profileId` as an alternative to an inline CSV mapping.
- [x] Give each response a concrete schema instead of generic `Object`/`List` placeholders.
- [x] Separate create-entry and response-entry schemas so response IDs and supported memo fields are accurate.
- [x] Align readiness failure responses and document a default Problem response for every API operation.
- [x] Use generated routing/types where they remove drift, plus runtime OpenAPI request validation; retain local transport types where custom parsing or null semantics are clearer.
- [x] Add contract-focused HTTP tests.

## Dependencies and developer workflow

- [x] Upgrade Chi to a version containing the `RealIP` security fixes.
- [x] Upgrade `golang.org/x/text` to a version containing the invalid-input loop fix.
- [x] Upgrade `kin-openapi` to the fixed release identified by `govulncheck`.
- [x] Make the main check fail rather than silently skip required PostgreSQL integration tests.
- [x] Include formatting verification, generation drift, `go vet`, race tests, build, and vulnerability scanning in documented checks.
- [x] Keep one end-to-end happy path and add focused integrity, import-recovery, and lifecycle assertions around it.
- [x] Remove/ignore editor log artifacts.

## Documentation

- [x] Document the immutable-reversed-entry and deferred-equation database guarantees.
- [x] Document import atomicity and batch state transitions.
- [x] Document reconciliation state transitions and ordering rules.
- [x] Update the readable schema reference, schema diagram, and product decisions.

## Explicitly deferred before hosted deployment

These require product and operational decisions beyond the current local, single-user backend. They must be revisited before exposing Money Matrix as a hosted service.

- [ ] Choose an authentication mechanism and credential/session policy.
- [ ] Add user or household ownership to every private resource and enforce authorization boundaries.
- [ ] Define idempotency behavior for externally retried financial commands.
- [ ] Define original-upload retention, encryption, deletion, and object-storage policy.
- [ ] Add production secrets management, TLS/ingress, backup/restore verification, rate limiting, and deployment packaging.
