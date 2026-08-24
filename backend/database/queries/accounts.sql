-- name: CreateFinancialAccount :one
INSERT INTO financial_accounts (id, name, kind, balance_class, currency, note)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListAccountSummaries :many
SELECT
    a.id,
    a.name,
    a.kind,
    a.balance_class,
    a.currency,
    a.note,
    COALESCE(SUM(p.amount) FILTER (WHERE t.status IN ('posted', 'reversed')), 0)::bigint AS balance,
    (a.archived_at IS NOT NULL)::boolean AS archived
FROM financial_accounts a
LEFT JOIN postings p ON p.financial_account_id = a.id
LEFT JOIN transactions t ON t.id = p.transaction_id
GROUP BY a.id
ORDER BY a.archived_at NULLS FIRST, a.name;

-- name: UpdateFinancialAccount :execrows
UPDATE financial_accounts
SET name = COALESCE(sqlc.narg('name'), name),
    note = CASE WHEN sqlc.arg('note_is_set')::boolean THEN sqlc.narg('note') ELSE note END,
    updated_at = now()
WHERE id = $1;

-- name: ArchiveFinancialAccount :execrows
UPDATE financial_accounts
SET archived_at = now(), updated_at = now()
WHERE id = $1;

-- name: UnarchiveFinancialAccount :execrows
UPDATE financial_accounts
SET archived_at = NULL, updated_at = now()
WHERE id = $1;

-- name: ListCategorySummaries :many
SELECT id, name, kind, parent_id, (archived_at IS NOT NULL)::boolean AS archived
FROM categories
ORDER BY archived_at NULLS FIRST, kind, name;

-- name: CreateCategory :one
INSERT INTO categories (id, name, kind, parent_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ArchiveCategory :execrows
UPDATE categories
SET archived_at = now(), updated_at = now()
WHERE id = $1;

-- name: UnarchiveCategory :execrows
UPDATE categories
SET archived_at = NULL, updated_at = now()
WHERE id = $1;

-- name: ListBucketSummaries :many
SELECT
    b.id,
    b.name,
    b.note,
    (b.archived_at IS NOT NULL)::boolean AS archived,
    (b.id = '00000000-0000-0000-0000-000000000001')::boolean AS system,
    COALESCE(SUM(be.amount) FILTER (WHERE t.status IN ('posted', 'reversed')), 0)::bigint AS balance
FROM buckets b
LEFT JOIN bucket_entries be ON be.bucket_id = b.id
LEFT JOIN transactions t ON t.id = be.transaction_id
GROUP BY b.id
ORDER BY system DESC, b.archived_at NULLS FIRST, b.name;

-- name: CreateBucket :one
INSERT INTO buckets (id, name, note)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ArchiveBucket :execrows
UPDATE buckets
SET archived_at = now(), updated_at = now()
WHERE id = $1
  AND id <> '00000000-0000-0000-0000-000000000001';

-- name: UnarchiveBucket :execrows
UPDATE buckets
SET archived_at = NULL, updated_at = now()
WHERE id = $1;
