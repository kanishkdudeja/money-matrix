# Money Matrix Database Schema

This is the readable reference for the Money Matrix PostgreSQL schema. The executable source of truth is the single development-phase Goose migration, [`00001_initial_schema.sql`](../backend/database/migrations/00001_initial_schema.sql).

For the meaning and rationale behind these records, see [Product vision and financial model](financial-model-and-product-vision.md).

## Schema at a glance

| Area | Tables | Purpose |
|---|---|---|
| Ledger | `financial_accounts`, `transactions`, `postings` | Real financial events and account effects |
| Purpose and classification | `categories`, `buckets`, `bucket_entries` | Purpose-based balances with an optional category on each exact split |
| Imports | `parser_profiles`, `import_batches`, `imported_rows` | Statement ingestion, normalized rows, and review evidence |
| Automation | `categorization_rules` | Prioritized deterministic suggestions |
| Reconciliation | `reconciliations`, `reconciliation_postings` | Statement checkpoints and their exact posting membership |
| Planning | `plans`, `recurring_rules` | Reserved schema for expected and recurring activity |
| Migration tooling | `goose_db_version` | Goose-owned migration history; not an application-domain table |

## Common conventions

| Convention | Meaning |
|---|---|
| Primary keys | Application-generated UUIDs |
| Time | `timestamptz`, normally defaulting to `now()` |
| Business dates | PostgreSQL `date`; no time-of-day ambiguity |
| Money | Columns use contextual names such as `amount` and `balance`; every value is a signed `bigint` in minor currency units, so INR uses paise |
| Currency | The initial financial-account model is constrained to `INR`; amounts use paise |
| Entry ordering | Zero-based non-negative `position`, unique within a transaction and entry type |
| Deletion | Referenced domain records use `ON DELETE RESTRICT`; catalogs are archived instead of deleted |
| Mutable timestamps | `updated_at` is maintained by application writes; there is no database trigger |
| Flexible import configuration | `jsonb`, while core ledger relationships remain relational |

## Relationship summary

| Parent | Child | Cardinality | Foreign key / rule |
|---|---|---:|---|
| `financial_accounts` | `postings` | 1:N | `postings.financial_account_id` |
| `transactions` | `postings` | 1:N | `postings.transaction_id` |
| `transactions` | reversing `transactions` | 1:0..1 | `transactions.reversal_of_id`, unique when present |
| `categories` | child `categories` | 1:N | `categories.parent_id` |
| `transactions` | `bucket_entries` | 1:N | `bucket_entries.transaction_id` |
| `buckets` | `bucket_entries` | 1:N | `bucket_entries.bucket_id` |
| `categories` | `bucket_entries` | 1:N, optional on child | `bucket_entries.category_id` |
| `financial_accounts` | `import_batches` | 1:N | `import_batches.financial_account_id` |
| `parser_profiles` | `import_batches` | 1:N, optional on child | `import_batches.parser_profile_id` |
| `import_batches` | `imported_rows` | 1:N | `imported_rows.import_batch_id` |
| `transactions` | `imported_rows` | 1:0..1 | `imported_rows.transaction_id`, unique when present |
| `categories` | `categorization_rules` | 1:N, optional on child | `categorization_rules.category_id` |
| `buckets` | `categorization_rules` | 1:N, optional on child | `categorization_rules.bucket_id` |
| `financial_accounts` | `reconciliations` | 1:N | `reconciliations.financial_account_id` |
| `reconciliations` | `reconciliation_postings` | 1:N | `reconciliation_postings.reconciliation_id` |
| `postings` | `reconciliation_postings` | 1:0..1 | `reconciliation_postings.posting_id` is unique |
| `plans` | `recurring_rules` | 1:N, optional on child | `recurring_rules.plan_id` |
| Account/category/bucket | `recurring_rules` | 1:N, optional on child | Optional target foreign keys |

## Ledger tables

### `financial_accounts`

Real stores of value and debt. Balances are derived from postings and are not stored on this table.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `name` | `text` | Not null | Unique account name |
| `kind` | `text` | Not null | `bank`, `cash`, `credit_card`, `loan`, `investment`, or `other` |
| `currency` | `char(3)` | Not null; `INR` | Initial backend requires exactly `INR` |
| `note` | `text` | Nullable | User-entered notes |
| `archived_at` | `timestamptz` | Nullable | Non-null means archived |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |
| `balance_class` | `text` | Not null; `asset` | `asset` or `liability` |

Derived account balance:

```text
account balance = sum(postings.amount for the account)
```

### `transactions`

The dated and auditable parent event. It intentionally has no fixed source or destination columns; account effects live in `postings`.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `occurred_on` | `date` | Not null | Business date of the event |
| `description` | `text` | Not null | Trimmed value must not be empty |
| `kind` | `text` | Not null | `income`, `expense`, `transfer`, `refund`, `adjustment`, `opening_balance`, or `bucket_transfer` |
| `status` | `text` | Not null; `posted` | `draft`, `posted`, or `reversed` |
| `origin` | `text` | Not null | `manual`, `import`, `recurring_rule`, or `system` |
| `reversal_of_id` | `uuid` | Nullable | Self-reference to the transaction being reversed; cannot equal `id` |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

`reversal_of_id` has a partial unique index, so an original transaction can have at most one reversing transaction.

### `postings`

Signed changes to real financial accounts.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `transaction_id` | `uuid` | Not null | References `transactions(id)` with delete restricted |
| `financial_account_id` | `uuid` | Not null | References `financial_accounts(id)` with delete restricted |
| `amount` | `bigint` | Not null | Signed amount in minor currency units; cannot be zero |
| `position` | `smallint` | Not null | Non-negative ordering within the transaction |
| `memo` | `text` | Nullable | Entry-specific explanation |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |

`(transaction_id, position)` is unique. The account index begins with `financial_account_id` for account balance and history queries.

## Purpose and classification tables

### `categories`

Reusable income and spending classifications.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `name` | `text` | Not null | Unique together with `kind` |
| `kind` | `text` | Not null | `income` or `expense` |
| `parent_id` | `uuid` | Nullable | Self-reference for hierarchy; cannot equal `id`; delete restricted |
| `archived_at` | `timestamptz` | Nullable | Non-null means archived |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

The database requires a parent and child to have the same kind and rejects both direct and deeper hierarchy cycles.

### `buckets`

Virtual purposes for which financial coverage is reserved.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `name` | `text` | Not null | Unique bucket name |
| `note` | `text` | Nullable | User-entered explanation |
| `archived_at` | `timestamptz` | Nullable | Non-null means archived |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

The initial migration seeds the permanent system bucket:

| Field | Seeded value |
|---|---|
| `id` | `00000000-0000-0000-0000-000000000001` |
| `name` | `Unallocated` |
| `note` | Money that has not yet been reserved for another purpose. |

The reserved UUID—not the display name—is its machine identity. The API derives `system: true` from that ID, and a database trigger prevents the row from being deleted, reidentified, or archived.

### `bucket_entries`

Signed changes to virtual bucket balances. This is also the transaction's classification split: the category is optional, but the bucket is always known.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `transaction_id` | `uuid` | Not null | References `transactions(id)`; delete restricted |
| `bucket_id` | `uuid` | Not null | References `buckets(id)`; delete restricted |
| `category_id` | `uuid` | Nullable | Optional income/spending classification; references `categories(id)`; delete restricted |
| `amount` | `bigint` | Not null | Signed amount in minor currency units; cannot be zero |
| `position` | `smallint` | Not null | Non-negative split order |
| `memo` | `text` | Nullable | Entry-specific explanation |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |

`(transaction_id, position)` is unique. Indexes beginning with `bucket_id` and non-null `category_id` support both balance and classification reporting. There is deliberately no separate bucket-transaction table: `bucket_transfer` transactions parent uncategorized entries that sum to zero.

## Import tables

### `parser_profiles`

Versioned mappings from institution-specific statement layouts to normalized fields.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `name` | `text` | Not null | Profile name, unique together with version |
| `format` | `text` | Not null | `csv`, `xlsx`, or `pdf` |
| `institution` | `text` | Nullable | Bank or issuer associated with the layout |
| `mapping` | `jsonb` | Not null; `{}` | Parser-specific column and normalization configuration |
| `parser_version` | `text` | Not null | Version of this mapping/parser behavior |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

`(name, parser_version)` is unique. Format support in the schema is broader than current implementation: the initial executable importer is CSV-first.

### `import_batches`

One uploaded statement associated with one financial account.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `financial_account_id` | `uuid` | Not null | References `financial_accounts(id)`; delete restricted |
| `parser_profile_id` | `uuid` | Nullable | References `parser_profiles(id)`; delete restricted |
| `format` | `text` | Not null | `csv`, `xlsx`, or `pdf` |
| `file_name` | `text` | Not null | Original upload name |
| `file_hash` | `text` | Not null | Content identity used for duplicate-upload detection |
| `status` | `text` | Not null | `uploaded`, `processing`, `ready`, `failed`, or `completed` |
| `statement_start` | `date` | Nullable | Earliest statement date when known |
| `statement_end` | `date` | Nullable | Latest statement date when known |
| `error_detail` | `text` | Nullable | Batch-level failure explanation |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

`(financial_account_id, file_hash)` is unique, so the same content cannot be imported twice into the same account.

### `imported_rows`

Preserved source evidence plus normalized and reviewable transaction data.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `import_batch_id` | `uuid` | Not null | References `import_batches(id)`; delete restricted |
| `source_row` | `integer` | Not null | Non-negative source-row number |
| `raw_data` | `jsonb` | Not null | Original row represented as structured data |
| `transaction_date` | `date` | Nullable | Normalized transaction date |
| `value_date` | `date` | Nullable | Normalized value/settlement date |
| `description` | `text` | Nullable | Normalized payee or narrative |
| `reference` | `text` | Nullable | Bank-provided reference |
| `amount` | `bigint` | Nullable | Signed normalized amount in minor currency units |
| `balance` | `bigint` | Nullable | Statement running balance in minor currency units when supplied |
| `currency` | `char(3)` | Not null; `INR` | Must equal its uppercase form |
| `fingerprint` | `text` | Nullable | Stable normalized identity for row-level duplicate detection |
| `transaction_id` | `uuid` | Nullable | References the created ledger transaction; delete restricted |
| `review_status` | `text` | Not null; `pending` | `pending`, `suggested`, `reviewed`, `skipped`, `duplicate`, or `invalid` |
| `parse_errors` | `jsonb` | Not null; `[]` | Structured row-level parsing problems |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

`(import_batch_id, source_row)` is unique. A partial unique index on non-null `transaction_id` ensures a ledger transaction is linked to at most one imported row. A partial fingerprint index speeds duplicate lookup but does not impose global uniqueness, because legitimate repeated transactions can share normalized attributes.

## Automation table

### `categorization_rules`

Prioritized deterministic rules that can suggest transaction classification and allocation.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `name` | `text` | Not null | User-readable rule name |
| `priority` | `integer` | Not null; `0` | Higher values are evaluated first |
| `conditions` | `jsonb` | Not null | Match conditions interpreted by the application |
| `category_id` | `uuid` | Nullable | Suggested category; delete restricted |
| `bucket_id` | `uuid` | Nullable | Suggested bucket; delete restricted |
| `transaction_kind` | `text` | Nullable | Suggested valid transaction kind |
| `auto_apply` | `boolean` | Not null; `false` | Stored policy flag for automatic application |
| `enabled` | `boolean` | Not null; `true` | Whether the matcher considers this rule |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

At least one result—`category_id`, `bucket_id`, or `transaction_kind`—must be non-null.

The current application understands these optional condition keys:

| JSON key | Value | Meaning |
|---|---|---|
| `descriptionContains` | String | Case-insensitive substring match |
| `direction` | `credit` or `debit` | Match positive or negative normalized amount |
| `minimumAmount` | Integer | Minimum absolute amount, expressed in minor currency units |
| `maximumAmount` | Integer | Maximum absolute amount, expressed in minor currency units |

## Reconciliation tables

### `reconciliations`

Account balance checkpoints at statement dates.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `financial_account_id` | `uuid` | Not null | References `financial_accounts(id)`; delete restricted |
| `statement_date` | `date` | Not null | End date of the checkpoint |
| `statement_balance` | `bigint` | Not null | Balance stated by the institution, in minor currency units |
| `status` | `text` | Not null | `in_progress`, `completed`, or `reopened` |
| `completed_at` | `timestamptz` | Nullable | Required when status is `completed` |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

`(financial_account_id, statement_date)` is unique. A partial unique index allows at most one `in_progress` or `reopened` row for an account. The database check ensures a completed row has `completed_at`; application logic also requires the computed balance to equal the statement balance, requires forward statement-date order, and allows only the latest completed checkpoint to be reopened.

### `reconciliation_postings`

The exact set of postings captured by completed reconciliation checkpoints.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `reconciliation_id` | `uuid` | Not null | References `reconciliations(id)`; delete restricted |
| `posting_id` | `uuid` | Not null | References `postings(id)`; delete restricted and globally unique in this table |
| `created_at` | `timestamptz` | Not null; `now()` | Membership creation time |

The composite primary key is `(reconciliation_id, posting_id)`. The separate unique constraint on `posting_id` ensures each posting belongs to at most one checkpoint.

## Planning tables

The planning tables express the intended model but are not yet exposed through the initial backend API.

### `plans`

Expected financial activity for a defined period, kept separate from actual ledger events.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `name` | `text` | Not null | Plan name |
| `period_start` | `date` | Not null | Inclusive plan start |
| `period_end` | `date` | Not null | Inclusive plan end; cannot precede start |
| `status` | `text` | Not null | `draft`, `active`, or `closed` |
| `currency` | `char(3)` | Not null; `INR` | Must equal its uppercase form |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

### `recurring_rules`

Schedules for expected repeated activity. A rule can reference any combination of the optional planning and classification targets.

| Column | Type | Null / default | Constraints and meaning |
|---|---|---|---|
| `id` | `uuid` | Not null | Primary key |
| `name` | `text` | Not null | Rule name |
| `schedule` | `text` | Not null | Schedule expression; application interpretation is deferred |
| `expected_amount` | `bigint` | Nullable | Expected signed amount in minor currency units |
| `financial_account_id` | `uuid` | Nullable | Optional account target; delete restricted |
| `category_id` | `uuid` | Nullable | Optional category target; delete restricted |
| `bucket_id` | `uuid` | Nullable | Optional bucket target; delete restricted |
| `plan_id` | `uuid` | Nullable | Optional plan association; delete restricted |
| `enabled` | `boolean` | Not null; `true` | Whether future scheduling should consider the rule |
| `created_at` | `timestamptz` | Not null; `now()` | Creation time |
| `updated_at` | `timestamptz` | Not null; `now()` | Last application-managed update time |

## Indexes and uniqueness

Primary keys and table-level unique constraints create their own PostgreSQL indexes. The schema also declares these explicit indexes:

| Index | Table / columns | Purpose |
|---|---|---|
| `transactions_one_reversal_per_transaction` | `transactions(reversal_of_id)` where non-null | Allows at most one reversal for an original transaction |
| `transactions_occurred_on_idx` | `transactions(occurred_on DESC, id)` | Chronological transaction listing with stable UUID tie-breaker |
| `postings_account_idx` | `postings(financial_account_id, transaction_id)` | Account balance and account history access |
| `bucket_entries_bucket_idx` | `bucket_entries(bucket_id, transaction_id)` | Bucket balances and history |
| `bucket_entries_category_idx` | `bucket_entries(category_id, transaction_id)` where category is non-null | Category totals and history |
| `imported_rows_transaction_idx` | `imported_rows(transaction_id)` where non-null, unique | One imported row per created ledger transaction |
| `imported_rows_fingerprint_idx` | `imported_rows(fingerprint)` where non-null | Row fingerprint duplicate search |
| `import_batches_status_created_at_idx` | `import_batches(status, created_at DESC, id)` | Status-filtered recovery and discovery |
| `reconciliations_one_open_per_account` | `reconciliations(financial_account_id)` for open statuses, unique | At most one open lifecycle per account |

Important unique constraints include:

| Table | Unique columns | Meaning |
|---|---|---|
| `financial_accounts` | `name` | Account names do not collide |
| `categories` | `kind, name` | Income and expense may reuse a name, but duplicates within one kind are forbidden |
| `buckets` | `name` | Bucket names do not collide; the fixed Unallocated UUID is its stable machine identity |
| `postings`, `bucket_entries` | `transaction_id, position` | Split order is unique within each entry layer |
| `parser_profiles` | `name, parser_version` | Profile versions are individually addressable |
| `import_batches` | `financial_account_id, file_hash` | Same statement content cannot be uploaded twice for one account |
| `imported_rows` | `import_batch_id, source_row` | A source row appears once in its batch |
| `reconciliations` | `financial_account_id, statement_date` | One checkpoint per account and date |
| `reconciliation_postings` | `posting_id` | A posting is frozen into no more than one checkpoint |

## Cross-table integrity guarantees

The application services validate commands before writing. PostgreSQL independently backstops the most important final-state rules with deferred constraint triggers, so they are checked after every statement in a multi-step transaction has finished.

| Invariant | Enforcement |
|---|---|
| Financial coverage change | Sum of asset postings minus sum of liability postings |
| Allocation coverage | Ledger service and deferred database trigger require bucket entries to total financial coverage |
| Missing allocation | Non-zero coverage with no supplied bucket entries gets one matching Unallocated entry |
| Category correlation | An optional `bucket_entries.category_id` structurally ties each classified amount to its exact bucket split; there is no independent split that can drift |
| Bucket transfer | Service and database require no postings or categorized entries, at least two distinct buckets, and a zero total |
| Archived targets | Go validation and insert/update triggers reject archived buckets and optional categories for new activity; technical reversals may reuse historical targets |
| Reconciled periods | New transactions or reversals cannot alter an account on or before its latest completed statement date |
| Atomic event write | Transaction, postings, and bucket entries commit or roll back together |
| Reconciliation lifecycle | Account locking serializes changes; only one row is open; dates advance; only the latest completed row can reopen |
| Reconciliation completion | Calculated account balance must equal the supplied statement balance; captured posting membership is non-overlapping |
| Reversal | A narrow ledger operation creates exact negating entries before marking the original `reversed`; original entries are then database-immutable |
| Category hierarchy | A database trigger requires equal parent/child kinds and prevents cycles |

The deferred ledger trigger skips `draft` transactions. Every other ordinary transaction must contain at least one posting and satisfy its posting-to-bucket equation. A `bucket_transfer` instead has its special zero-coverage shape. These checks run on commits that change a transaction or either entry layer, including SQL executed outside the Go services.

The primary allocation health equation is:

```text
sum(asset account balances) - sum(liability account balances)
    = sum(bucket balances)
```

## Migration history

| Migration | Effect |
|---|---|
| `00001_initial_schema.sql` | Creates the complete initial ledger, purpose/classification, import, reconciliation, automation, and planning schema; seeds Unallocated; and installs the integrity constraints and deferred triggers |

Goose maintains its own `goose_db_version` table to record which migrations have run. Application code should not treat that table as domain data.

## Reading status and balances

| Value | Derived from |
|---|---|
| Financial account balance | Sum of the account’s postings belonging to balance-active transactions |
| Bucket balance | Sum of the bucket’s entries belonging to balance-active transactions |
| Category total for a period | Sum of bucket entries with the matching non-null category, filtered by transaction date/status |
| Dashboard assets | Sum of balances for asset-class accounts |
| Dashboard liabilities | Sum of balances for liability-class accounts |
| Dashboard allocated coverage | Sum of all bucket balances, including Unallocated |
| Reconciliation difference | Computed account balance through statement date minus statement balance |

The current backend includes original transactions marked `reversed` in balance calculations because the separate reversal transaction supplies equal and opposite entries. Excluding the original would incorrectly apply the correction twice.

## Evolution rules

When changing the schema:

1. During the current data-free development phase, keep the initial schema coherent in the single migration. Once any environment contains data that must be preserved, append ordered migrations and never rewrite its applied history.
2. Update SQL queries, regenerate sqlc output where relevant, and update the OpenAPI contract if the external shape changes.
3. Add integration coverage for constraints and cross-table behavior.
4. Update this reference and the product-model document when vocabulary or invariants change.
5. Preserve audit evidence and avoid migrations that recalculate historical meaning without an explicit, reviewable strategy.
