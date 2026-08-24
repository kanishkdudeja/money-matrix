# Money Matrix: Product Vision and Financial Model

This document records the product direction, shared financial vocabulary, and design decisions behind Money Matrix. It is intended to answer both “what are we building?” and “why is the model shaped this way?”

For exact database fields and constraints, see [Database schema](database-schema.md). For the HTTP contract, see [OpenAPI](../backend/openapi/openapi.yaml).

## Product vision

Money Matrix is a personal money workspace that connects three questions which are often handled by separate tools:

1. **What happened in the real world?** Bank, cash, card, loan, and investment account activity.
2. **What was the activity for?** Income and spending categories.
3. **What purpose was the money reserved for?** Virtual allocation buckets.

The app should make everyday finances trustworthy and explainable. A user should be able to import statements, review and classify most transactions quickly, reserve money for future purposes, reconcile the ledger with bank statements, and understand why every displayed balance has its value.

The initial product is a personal ledger and allocation system, not a complete business accounting, tax, or investment-performance platform. It borrows the rigor of double-entry-style modeling where that rigor is useful, without exposing traditional accounting terminology everywhere in the user interface.

## Product principles

- **Real money and plans are distinct.** Financial accounts describe money and debt that actually exist. Buckets describe intent. Plans describe expectations. One must not silently masquerade as another.
- **Every number should be traceable.** Balances are derived from immutable entries rather than being edited directly.
- **One event can have several views.** A transaction can affect accounts, describe income or spending, and affect reserved money at the same time.
- **Imports are evidence, not magic.** Original rows and parsing errors are retained so an automated result can be reviewed and explained.
- **Safe defaults beat missing data.** Money not assigned to a purpose goes to `Unallocated`; it does not disappear from the allocation view.
- **Correction should preserve history.** Posted activity is reversed rather than silently rewritten, especially after reconciliation.
- **Automation should remain reviewable.** Deterministic categorization suggestions come first. Learned predictions can be added later with confidence and user control.
- **Portability matters.** PostgreSQL owns durable data, migrations recreate the schema, and the API is described independently through OpenAPI.

## Original practical use cases

These are the everyday scenarios the model was chosen to support. They are product intent, not merely examples of the current database shape.

### Accounts, cards, and debt

- Track bank, cash, investment, credit-card, and loan accounts in one personal ledger.
- Treat bank/cash/investment accounts as assets and cards/loans as liabilities, so net financial coverage is assets minus amounts owed.
- Record a card purchase as one expense: the liability balance increases while the relevant bucket is consumed and the spending category is recorded.
- Record a credit-card payment as one coverage-neutral transfer: the bank asset decreases and the card liability decreases. It normally has no category or bucket effect because the spending was already recognized when the card was charged.
- Reconcile each account—including cards and loans—to its real statement without allowing later edits to silently invalidate a verified period.

### One real-world event with flexible splits

- Represent one purchase, salary receipt, transfer, refund, fee, or adjustment as one `Transaction`, even when it affects several accounts or purposes.
- Avoid fixed source/destination columns. A transaction can contain as many account `Posting` rows as the real event requires.
- Split one purchase across different buckets and categories. For example, a department-store payment can contain a Household / Groceries entry and a Gifts / Gifts entry.
- Link the same bucket more than once when its category split matters. For example, one Vacation-bucket hotel bill can have separate Accommodation and Fees entries.
- Change a bucket split without losing category totals because category and bucket are correlated on each `BucketEntry`, rather than stored as two independent splits whose relationship is unknown.

Every `BucketEntry` must have a bucket; its category is optional. A coverage-changing transaction therefore always has bucket coverage, but callers do not have to classify it immediately: the backend supplies an equal `Unallocated` entry when no entries are provided. A coverage-neutral account transfer normally has no bucket entries, while a bucket reassignment has bucket entries but no account postings.

### Allocation and classification

- Use categories to answer what income or spending was, such as Salary, Groceries, Rent, or Accommodation.
- Use buckets to answer what currently available money is reserved for, such as Monthly Bills, Emergency Fund, or Vacation.
- Reserve or move purpose allocation without moving real bank money through a `bucket_transfer` transaction.
- Keep unreviewed or not-yet-assigned coverage visible in the permanent `Unallocated` bucket rather than allowing allocation totals to drift away from financial coverage.

### Statements and trustworthy automation

- Import bank and card statements, retain each original row and parsing error as evidence, and create account activity without waiting for categorization.
- Suggest likely categories and buckets for recurring merchants while keeping the initial automation deterministic, explainable, and reviewable.
- Review, split, categorize, or deliberately skip imported rows without losing the underlying financial event.
- Detect repeated statement uploads and imported-row duplicates. Matching a new imported row to an equivalent manually entered transaction remains a documented follow-up because it requires conservative confidence rules.

### Corrections and audit history

- Correct posted activity by creating an exact negating reversal instead of rewriting history.
- Treat a merchant refund as a new business event—which may be partial—rather than confusing it with a technical reversal.
- Preserve the exact postings included in each completed reconciliation checkpoint and require the latest checkpoint to be deliberately reopened before correcting its protected period.

## The core model

Money Matrix represents one financial event through a common `Transaction` and two coordinated sets of effects.

| Layer | Record | Question answered | Example for a ₹450 hotel payment |
|---|---|---|---|
| Event | `Transaction` | What happened, when, and where did the record come from? | “Hotel”, 2026-08-03, expense, imported |
| Financial reality | `Posting` | Which real account balances changed? | Bank account −45,000 paise |
| Purpose and classification | `BucketEntry` | Which reserved purpose changed, and optionally what kind of activity was it? | Vacation bucket, Accommodation category, −45,000 paise |

Financial postings remain separate from purpose entries because real account balances and virtual reservations answer different questions. Categories and buckets remain separate reusable catalogs, but a category is attached to a particular bucket entry. This records their exact relationship instead of maintaining two splits whose correlation is unknown.

### Transaction

A transaction is the auditable real-world event and common parent for all entries. It holds the date, description, kind, lifecycle status, provenance, and reversal link.

It does **not** have fixed `source_account` and `destination_account` columns. Fixed endpoints only model simple transfers. Postings support income, expenses, split transfers, debt payments, fees, and future multi-account events without adding special columns.

The `origin` field means how the record entered Money Matrix—manual entry, import, recurring rule, or system action. It does not identify the source financial account.

### Posting

A posting is a signed change to one real financial account. Transaction metadata says that an event happened; postings contain its financial effects.

Keeping transactions and postings separate provides several benefits:

- A transfer can have one transaction with two postings instead of two unrelated transactions.
- A split event can affect more than two accounts.
- Account balances can always be calculated as sums of postings.
- Reversals can negate the original financial effects while retaining history.
- Reconciliation can attach to the exact account effects included in a statement checkpoint.

A bucket-only reassignment is still a transaction for auditability, but it has no postings because no real account changed.

### Category

A category answers **what was this income or spending?** Examples include Salary, Groceries, Rent, Interest, and Accommodation.

Categories are reusable labels organized as income or expense, with optional parent categories. A category is optional on each `BucketEntry`. Separate bucket entries allow a single purchase to be split—for example, one portion categorized as Groceries from the Household bucket and another categorized as Accommodation from the Vacation bucket.

Categories are optional. They are normally absent for events that are not income or spending, such as an ordinary transfer between the user’s accounts. They can also be omitted while an imported event awaits review. The uncategorized amount is explicit: it is the sum of bucket entries whose `category_id` is null.

### Bucket and bucket entry

A bucket answers **what purpose is this money reserved for?** Examples include Emergency Fund, Monthly Bills, Vacation, and New Laptop.

Buckets are virtual. They do not hold money separately at a bank and do not change the financial net position. Every `BucketEntry` has one bucket, an optional category, and a signed amount. It increases or decreases the amount available for that purpose. The balance of a bucket is the sum of all its entries.

Categories describe past or current activity; buckets describe intention and available allocation. The same hotel payment might be categorized as Accommodation and funded from the Vacation bucket. Keeping the catalogs distinct permits useful questions such as “How much did I spend on restaurants?” and “How much vacation money remains?” Storing both dimensions on the same entry also permits questions such as “Which categories consumed my Vacation bucket?” without guessing how two independent splits align.

There is no separate `bucket_transactions` table. A bucket reassignment uses the same transaction timeline and audit model as every other event: a `bucket_transfer` transaction with uncategorized bucket entries and no financial postings. `BucketEntry` is more precise than the earlier generic name `AllocationMovement`, because it identifies both the ledger layer and its relationship to the parent transaction.

### The Unallocated bucket

`Unallocated` is a seeded, permanent system bucket. It represents financial coverage that exists but has not yet been assigned to another purpose.

Its fixed UUID is the stable machine identity; the display name is not used as a key. No separate system-role column is needed while Unallocated is the only built-in bucket, and both the API and database prevent it from being archived or deleted.

When a transaction changes financial coverage and the caller supplies no bucket entries, the backend automatically creates an equal entry in `Unallocated`. This has two important effects:

- An imported transaction can affect the correct account balance immediately while remaining available for later review.
- The allocation equation stays complete; uncategorized or unreviewed money is explicit rather than absent.

Reviewing an imported transaction can replace its bucket breakdown and optional categories. Skipping categorization leaves the underlying financial event intact and its purpose in Unallocated.

### Financial account

A financial account is a real store of value or debt: bank, cash, credit card, loan, investment, or other.

It has two related classifications:

- `kind` describes the product and guides user-interface behavior.
- `balance_class` controls balance mathematics and is either `asset` or `liability`.

The explicit balance class is important because a product label alone can be ambiguous. An asset balance contributes positively to financial coverage; a liability balance represents an amount owed and is subtracted from it.

Statement amounts are normalized from the user’s financial-coverage perspective: positive means money in and negative means money out. That normalized amount is retained on the imported row and used unchanged for transaction intent and BucketEntries. At the import-to-ledger boundary, an asset account receives the same signed posting while a liability account receives its negation. For example, a credit-card purchase remains a negative review/allocation amount but becomes a positive posting because the amount owed increased. Keeping this conversion in the import service prevents bank, card, and future PDF/XLSX adapters from inventing different sign rules.

### Reconciliation

A reconciliation is a verified account balance at a statement date. It compares the balance calculated from postings with the statement balance supplied by the user.

A completed reconciliation records exactly which postings were included through a join table. A posting can belong to only one reconciliation checkpoint. Once an account has been reconciled through a date, the backend rejects new or reversing financial effects on or before that date. This protects a previously verified result from changing invisibly.

A newly created reconciliation begins as a non-locking draft. Its computed ledger balance, statement balance, and signed difference remain visible so missing or incorrect transactions can be resolved before completion. A never-completed draft may be discarded without changing ledger activity; a reopened checkpoint cannot be discarded because it represents established audit history. Only the latest completed checkpoint for an account can be reopened, and it must balance again before recompletion. Liability statements use the account-balance perspective, so a credit-card or loan statement balance is entered as the positive amount owed.

### Import batch, imported row, and parser profile

An `ImportBatch` represents one uploaded statement for one account. Its file name and content hash provide identity and duplicate-upload protection.

An `ImportedRow` preserves the source row, normalized fields, fingerprint, parse errors, review state, and optional link to the created transaction. Invalid and duplicate rows remain visible instead of being discarded.

A `ParserProfile` describes how a particular institution or statement layout maps to normalized fields. Profiles are versioned because banks change their exports over time.

The schema anticipates CSV, XLSX, and PDF. The initial implemented parser handles CSV. XLSX and PDF—especially scanned PDF/OCR—will require separate extraction adapters while retaining the same batch and review workflow.

### Categorization rule

A categorization rule is a deterministic suggestion based on normalized transaction data. A rule can propose a category, bucket, transaction kind, or a combination of them.

Current matching conditions include case-insensitive description text, debit or credit direction, and minimum or maximum absolute amount. Rules are evaluated in priority order. The schema records `auto_apply`, but the initial workflow favors reviewable suggestions; unattended application policy can be tightened after real usage demonstrates that the rules are reliable.

Learned categorization is a future layer. It should produce a suggestion and confidence, preserve the evidence behind the decision where practical, and fall back to manual review below a configurable confidence threshold.

### Plan and recurring rule

A plan describes expected activity for a period. A recurring rule describes anticipated repeated activity and can point at an account, category, bucket, or plan.

These concepts are intentionally separate from posted transactions. An expectation does not affect a real balance until it becomes an actual transaction. Their tables reserve the direction of the model, but plan and recurring automation are outside the currently implemented API scope.

## Amounts and sign conventions

All persisted amounts use signed 64-bit integers in the currency’s smallest unit. For INR, ₹450.00 is stored as `45000` paise. Floating-point values are never used for ledger arithmetic. Database columns and API properties use contextual names such as `amount` and `balance`; the minor-unit convention applies to every monetary value. API values are integer strings so JavaScript clients cannot lose precision.

### Financial postings

| Account balance class | Positive posting | Negative posting |
|---|---|---|
| Asset | Increases money/value held | Decreases money/value held |
| Liability | Increases the amount owed | Decreases the amount owed |

The displayed balance of each account is the signed sum of its postings. Financial coverage is calculated as:

```text
financial coverage = total asset balances - total liability balances
```

For a single transaction, its financial coverage change is:

```text
coverage change = sum(asset postings) - sum(liability postings)
```

### Bucket entries and categories

Bucket entries use the perspective of available financial coverage:

- Positive bucket entries add coverage to a reserved purpose and normally represent income or a refund when categorized.
- Negative bucket entries consume or move coverage out of a reserved purpose and normally represent spending when categorized.
- A category total is derived by summing bucket entries that reference that category.
- A null category makes the entry's uncategorized amount explicit without weakening the bucket equation.

For every ordinary transaction:

```text
sum(bucket entries) = financial coverage change
```

By design, a bucket transfer has:

```text
no financial postings
no categorized bucket entries
sum(bucket entries) = 0
at least two distinct buckets
```

The ledger service validates these equations before writing. PostgreSQL also runs a deferred integrity check when the database transaction commits, so a future code path cannot commit a malformed posted transaction merely by bypassing the service. Bucket transfers with postings, categorized entries, fewer than two distinct buckets, or a non-zero bucket total are rejected by both layers.

## Worked examples

Amounts below are shown in paise to match storage.

| Event | Financial postings | Bucket entries (`bucket / category / amount`) | Coverage change |
|---|---|---|---:|
| Salary received | Bank `+10000000` | Unallocated / Salary / `+10000000`, or a split totaling the same | `+10000000` |
| ₹450 bank-card hotel expense | Bank `-45000` | Vacation / Accommodation / `-45000` | `-45000` |
| ₹450 credit-card hotel charge | Credit card liability `+45000` | Vacation / Accommodation / `-45000` | `-45000` |
| ₹500 credit-card payment | Bank `-50000`; credit card liability `-50000` | None | `0` |
| Transfer between bank accounts | Checking `-200000`; Savings `+200000` | None | `0` |
| Reserve ₹200 for vacation | None | Unallocated / uncategorized / `-20000`; Vacation / uncategorized / `+20000` | `0` |
| ₹100 expense refund to bank | Bank `+10000` | Original funding bucket / Original expense category / `+10000` | `+10000` |

## Transaction kinds

| Kind | Meaning | Typical entry shape |
|---|---|---|
| `income` | New financial coverage received | Positive asset or negative liability effect; positive bucket entry, normally with an income category |
| `expense` | Financial coverage consumed | Negative asset or positive liability effect; negative bucket entry, normally with an expense category |
| `transfer` | Movement between financial accounts | Multiple postings whose coverage change is usually zero; normally no category or bucket entries |
| `refund` | Reversal of prior spending in business meaning, not necessarily a technical full reversal | Positive coverage with positive bucket entries, normally retaining the original categories |
| `adjustment` | Explicit correction or exceptional balance event | Shape depends on the correction; must still satisfy coverage invariants |
| `opening_balance` | Establishes an account’s starting position | Posting plus matching bucket coverage, normally Unallocated |
| `bucket_transfer` | Reassigns purpose without changing real money | No postings; at least two bucket entries summing to zero |

Kinds communicate intent but do not replace entry-level validation. The postings and entries remain the source of balance truth.

## Transaction lifecycle and corrections

Transactions have `draft`, `posted`, and `reversed` states. Current balance queries count posted financial effects and retain the effects of a reversed original alongside a separate negating reversal transaction. Together they net to zero while leaving both sides of the correction visible.

A technical reversal is different from a business refund:

- A **reversal** declares that a posted record should be negated as an audit-preserving correction. The reversing transaction points to the original, and only one reversal is allowed for each original transaction.
- A **refund** is a genuine new real-world event, potentially partial, received from a merchant or counterparty.

Accounts, categories, and buckets are archived rather than deleted from history. Foreign keys generally restrict deletion so a catalog record referenced by ledger activity cannot be removed accidentally.

Classification replacement is a deliberate operation rather than generic entry editing. It locks the parent transaction, accepts only a `posted` financial transaction, derives coverage from the stored postings, validates the complete replacement bucket breakdown and its optional categories, and writes it atomically. Entries on an original transaction become immutable once it is marked `reversed`, which prevents a later import review from changing one side of an established reversal pair. New activity and reclassification require active catalog targets. A technical reversal is the sole exception: it may reproduce archived historical targets because negating history must not require temporarily unarchiving them.

## Import and review workflow

The intended statement workflow is:

1. Upload a file for a financial account and select or infer a parser profile.
2. Hash the content and reject a duplicate upload for the same account.
3. Retain each raw source row and normalize dates, descriptions, references, amounts, and balances.
4. Mark unparseable rows as invalid with their errors; mark known row fingerprints as duplicates.
5. Create financial transactions and postings for valid new activity. Put their coverage in Unallocated initially.
6. Evaluate categorization rules and present suggestions in priority order.
7. Let the user confirm or replace bucket splits and attach optional categories to those exact splits, or skip the row while preserving the financial transaction.
8. Complete the batch once all actionable rows are resolved.
9. Reconcile the account against the statement ending balance.

The normalized ledger is never reconstructed solely from a later parser run. Retaining imported evidence lets future parser improvements coexist with what the user previously reviewed.

CSV parsing and all database writes for one upload are separate phases. After the file is fully parsed, the batch, preserved rows, and generated ledger transactions are committed in one serializable database transaction. An unexpected failure rolls the whole upload back, including its file hash, so the same file can be retried cleanly. The final state is derived after every row is considered:

| Final state | Meaning |
|---|---|
| `ready` | At least one imported row still needs review |
| `failed` | No row needs review and at least one row is invalid |
| `completed` | No actionable row remains; this includes duplicate-only batches |

Reviewing and skipping are also service-owned atomic transitions. A reviewed classification must still satisfy the ledger coverage equation and active-target policy. Import batches can be listed by status so pending work remains discoverable after the original upload response is lost.

## Reconciliation and dashboard equations

For an account and statement date, the computed reconciliation balance is the sum of eligible postings through that date. Completion is allowed only when:

```text
computed account balance - statement balance = 0
```

At most one reconciliation per account can be open (`in_progress` or `reopened`). Creating, completing, and reopening lock the account so concurrent lifecycle commands are serialized. Statement dates must move forward from the latest completed checkpoint, and only the latest completed checkpoint may be reopened. Completing captures the exact as-yet-unassigned postings through its statement date; reopening releases that checkpoint's membership before it can be completed again.

```text
create incomplete -> in_progress -> completed
latest completed  -> reopened    -> completed
```

Across the whole ledger, the main allocation health check is:

```text
total asset balances - total liability balances = total bucket balances
```

The dashboard can display the difference between the two sides. A zero difference means all financial coverage is represented by bucket allocation, including Unallocated. Category totals do not participate in this equation because categories classify flows rather than represent current reserved balances.

## Architectural decisions that support the model

### Modular monolith

The backend starts as one Go service with clear internal boundaries for HTTP delivery, ledger rules, imports, and database access. This keeps transactions and invariants easy to enforce without introducing distributed-system coordination. Modules can be separated later only if real scale or organizational pressure justifies it.

### Go, Chi, and the standard library

Go provides a small deployment artifact, strong concurrency primitives, and straightforward operational behavior. Chi adds lightweight routing and middleware while preserving standard `net/http` handlers. There is no Fastify layer; Fastify is a Node.js web framework and is unnecessary in a Go service.

### PostgreSQL, pgx, sqlc, and Goose

PostgreSQL supplies transactions, constraints, JSON support for flexible import mappings, and durable relational integrity. `pgx` is the native driver, `sqlc` generates type-safe Go from authored SQL, and Goose applies ordered migrations. The schema can be reproduced on another machine from migrations, while actual data can be moved with PostgreSQL backup and restore tools.

All production SQL is authored under `backend/database/queries` and consumed through generated `dbgen.Queries`; HTTP and domain packages do not assemble SQL strings. Multi-table financial workflows depend on a narrow, consumer-defined `Transactor` interface. Its PostgreSQL implementation uses `pgx.BeginTxFunc` with serializable isolation, binds sqlc queries to the transaction, and retries database-only callbacks after serialization or deadlock failures. The ledger, import, and reconciliation services are the only application-level entry points for their respective multi-table mutations. This keeps commit and rollback policy in one place while avoiding repository interfaces for simple CRUD operations that have only one implementation.

The database backstops only invariants that are both central and practical to state relationally: the final posting-to-bucket equation, uncategorized bucket-transfer shape, immutable reversed entries, active targets, category hierarchy validity, and one open reconciliation per account. Reconciliation ordering and import state transitions remain in small Go services with locks and transactions. Moving those workflows into triggers or stored procedures would duplicate domain behavior and make the implementation harder to reason about without adding a meaningful safety guarantee.

### OpenAPI as the client contract

The API contract is documented in OpenAPI so frontend and backend can evolve against explicit request and response shapes. Generated Chi server registration owns the HTTP method, path, path-parameter, and query-parameter bindings; a thin adapter delegates to the application handlers. This creates a compile-time failure when a contract operation is not implemented. Runtime OpenAPI validation rejects transport-level shape, format, and enum drift before a handler runs. Financial domain validation remains in the ledger, import, and reconciliation services; none of those rules live in generated transport code.

### Testing strategy

The backend uses a testing pyramid suited to the risk:

- Fast unit tests exercise pure calculations, parsing, validation, and rule matching.
- PostgreSQL-backed integration tests exercise migrations, constraints, transactions, HTTP workflows, imports, reversals, and reconciliation.
- Browser end-to-end tests cover a small set of critical user journeys through the frontend, real Go API, and PostgreSQL.

The integration layer is especially important because the most valuable properties—atomic writes, uniqueness, foreign keys, and reconciliation protection—depend on real PostgreSQL behavior.

## Current scope and deliberate deferrals

### Implemented in the initial backend

- Financial account, category, and bucket catalogs with archiving and restoration
- Asset and liability balance behavior
- Transactions with financial postings and bucket splits, each optionally categorized
- Automatic Unallocated coverage
- Bucket transfers and transaction reversals
- Dashboard totals and the coverage equation
- CSV parser profiles and statement imports
- Raw-row retention, duplicate detection, invalid-row reporting, review, and skipping
- Deterministic categorization suggestions
- Reconciliation checkpoints and reconciled-period protection
- CSV transaction export
- OpenAPI contract and database-backed workflow tests

### Designed for later work

- Matching imported statement rows to existing unmatched manual transactions. Until this is implemented, importing a bank row that was already entered manually can create a second transaction; fingerprint deduplication currently only recognizes rows seen in earlier imports. Matching should use account, signed amount, date proximity, reference/description evidence, and conservative confidence rules, with ambiguous candidates requiring confirmation.
- XLSX parsing and PDF text/table extraction, including an OCR strategy for scanned statements
- Learned categorization with confidence thresholds and feedback
- Plan and recurring-rule APIs and automation
- Authentication, multiple users, households, and authorization boundaries
- Idempotency keys and retry semantics for externally retried financial commands
- File/object storage policy for retaining original uploaded documents
- Hosted secrets management, TLS/ingress, rate limiting, verified backups, and deployment packaging
- Notifications, scheduled imports, and bank integrations
- Rich reporting, cash-flow forecasting, and investment performance
- Explicit foreign-exchange conversion and multi-currency net-worth semantics

Although every financial account and plan stores a currency code, the initial account API and database enforce INR so cross-account arithmetic cannot accidentally combine currencies. Cross-currency aggregation must not be introduced until exchange-rate sources, valuation dates, and gain/loss semantics are designed explicitly.

## Follow-up roadmap

The initial local, single-user application is ready for hands-on use. Before choosing the next major feature, test it with representative statements from the banks and cards it is expected to support. Real usage should determine the exact ordering, but the current priorities are:

### 1. Import intelligence and format coverage

- Match imported rows conservatively against existing unmatched manual transactions so the same real-world event is not recorded twice. Exact, high-confidence matches may be linked automatically; ambiguous candidates must require confirmation.
- Add XLSX statement ingestion while preserving the same normalized imported-row and review workflow used by CSV.
- Add PDF text and table extraction, followed by an explicit OCR strategy for scanned statements.
- Refine parser-profile creation and versioning using actual institution formats and better diagnostics for format changes.
- Evolve categorization from deterministic, reviewable rules toward learned suggestions with confidence thresholds. Automatic application should be limited to a deliberately trusted policy and remain auditable.

### 2. Everyday usability and reporting

- Add transaction search and filters for account, date range, kind, status, category, bucket, and description.
- Add supported edit operations for account, bucket, and category names or notes. Posted transactions remain immutable and continue to use reversal for financial corrections.
- Add reporting only where it answers a concrete question, beginning with spending, income, bucket usage, and cash-flow views.
- Add plans and recurring-transaction workflows after their scheduling semantics and APIs are finalized.

### 3. Additional confidence checks

- Extend real-browser coverage for understandable archived-target and reconciliation-protected-period failures.
- Exercise imports using representative files from each supported institution and retain sanitized fixtures for regression tests.
- Verify backup and restore procedures before relying on the application for irreplaceable history.

### 4. Hosted-product readiness

Before exposing Money Matrix as a hosted service, choose and implement authentication, user or household ownership, authorization boundaries, original-upload storage and retention, idempotency for externally retried commands, secrets management, TLS/ingress, rate limiting, monitored backups, and deployment packaging. These concerns are intentionally deferred while the application remains a local single-user tool.

## Non-goals for the initial product

- General-ledger accounting for companies
- Invoicing, payroll, tax filing, or statutory reporting
- Direct editing of computed account or bucket balances
- Treating a plan as if money has already moved
- Hiding failed imports or silently discarding source rows
- Guessing foreign-exchange values without an explicit valuation model
- Splitting the backend into microservices before there is a demonstrated need

## Glossary

| Term | Concise definition |
|---|---|
| Financial coverage | Assets minus liabilities; the net amount that must be represented across buckets |
| Transaction | The dated, auditable parent event |
| Posting | A signed effect on a real financial account |
| Category | A reusable income or spending classification |
| Bucket | A virtual purpose for which financial coverage is reserved |
| Bucket entry | A signed increase or decrease to one bucket, optionally classified by one category |
| Unallocated | The system bucket for coverage not assigned to another purpose |
| Reversal | A new transaction that negates an earlier transaction while preserving history |
| Refund | A real-world receipt reversing some prior spending; it may be partial |
| Reconciliation | Verification of a calculated account balance against a statement at a date |
| Parser profile | A versioned mapping from a statement format to normalized import fields |
| Imported row | Preserved source evidence and its normalization/review state |
| Categorization rule | A prioritized deterministic rule that suggests classification or allocation |
| Plan | Expected activity for a defined period, separate from actual ledger effects |
| Recurring rule | A schedule for anticipated repeated activity |

## Decision record summary

| Decision | Reason |
|---|---|
| Use a transaction with separate posting and bucket-entry layers | Keeps real balances separate from virtual purpose balances while connecting them to one auditable event |
| Do not store fixed source/destination columns | Postings model transfers and splits without a two-endpoint limitation |
| Keep category and bucket catalogs separate, but put the optional category on `BucketEntry` | “What was it?” and “What was the money reserved for?” remain distinct questions, while every classified amount has an exact bucket correlation |
| Use `BucketEntry`, not a separate bucket-transaction table or generic `AllocationMovement` | One transaction timeline is sufficient and the entry name is precise |
| Seed a system Unallocated bucket | Makes incomplete allocation explicit and preserves the coverage equation |
| Store amounts as integer minor units | Prevents floating-point rounding and supports exact equality checks |
| Name monetary fields contextually (`amount`, `balance`) | The minor-unit convention is global, so repeating it in every database and API property adds noise |
| Store both account kind and asset/liability class | Product type and balance mathematics are related but not identical |
| Preserve corrections through reversals | Keeps an auditable history and protects reconciled results |
| Preserve raw imported rows | Makes parsing, duplicate handling, and later review explainable |
| Start with CSV and deterministic rules | Provides a reliable vertical slice before format/OCR and ML complexity |
| Keep plans separate from actual transactions | Forecasts must not change real balances before an event occurs |
| Start with a modular monolith | Maximizes transactional correctness and development speed for the current scope |
