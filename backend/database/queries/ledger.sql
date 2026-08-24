-- name: CreateTransaction :one
INSERT INTO transactions (
    id, occurred_on, description, kind, status, origin, reversal_of_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: CreatePosting :one
INSERT INTO postings (
    id, transaction_id, financial_account_id, amount, position, memo
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateBucketEntry :one
INSERT INTO bucket_entries (
    id, transaction_id, bucket_id, category_id, amount, position, memo
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetTransactionDetails :one
SELECT
    t.id,
    t.occurred_on,
    t.description,
    t.kind,
    t.status,
    t.origin,
    t.reversal_of_id,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', p.id::text,
            'accountId', p.financial_account_id::text,
            'amount', p.amount::text,
            'memo', p.memo
        ) ORDER BY p.position)
        FROM postings p
        WHERE p.transaction_id = t.id
    ), '[]'::jsonb)::text AS postings,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', be.id::text,
            'bucketId', be.bucket_id::text,
            'categoryId', be.category_id::text,
            'amount', be.amount::text,
            'memo', be.memo
        ) ORDER BY be.position)
        FROM bucket_entries be
        WHERE be.transaction_id = t.id
    ), '[]'::jsonb)::text AS bucket_entries
FROM transactions t
WHERE t.id = $1;

-- name: ListTransactionDetails :many
SELECT
    t.id,
    t.occurred_on,
    t.description,
    t.kind,
    t.status,
    t.origin,
    t.reversal_of_id,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', p.id::text,
            'accountId', p.financial_account_id::text,
            'amount', p.amount::text,
            'memo', p.memo
        ) ORDER BY p.position)
        FROM postings p
        WHERE p.transaction_id = t.id
    ), '[]'::jsonb)::text AS postings,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', be.id::text,
            'bucketId', be.bucket_id::text,
            'categoryId', be.category_id::text,
            'amount', be.amount::text,
            'memo', be.memo
        ) ORDER BY be.position)
        FROM bucket_entries be
        WHERE be.transaction_id = t.id
    ), '[]'::jsonb)::text AS bucket_entries
FROM transactions t
ORDER BY t.occurred_on DESC, t.created_at DESC
LIMIT $1 OFFSET $2;

-- name: GetFinancialCoverageTarget :one
SELECT
    a.balance_class,
    (a.archived_at IS NOT NULL)::boolean AS archived,
    (SELECT max(r.statement_date)
     FROM reconciliations r
     WHERE r.financial_account_id = a.id
       AND r.status = 'completed')::date AS reconciled_through
FROM financial_accounts a
WHERE a.id = $1;

-- name: GetCategoryTarget :one
SELECT (archived_at IS NOT NULL)::boolean AS archived
FROM categories
WHERE id = $1;

-- name: GetBucketTarget :one
SELECT (archived_at IS NOT NULL)::boolean AS archived
FROM buckets
WHERE id = $1;

-- name: LockTransactionForReversal :one
SELECT status
FROM transactions
WHERE id = $1
FOR UPDATE;

-- name: MarkTransactionReversed :exec
UPDATE transactions
SET status = 'reversed',
    updated_at = now()
WHERE id = $1;

-- name: LockTransactionForClassification :one
SELECT status, kind
FROM transactions
WHERE id = $1
FOR UPDATE;

-- name: GetTransactionFinancialCoverage :one
SELECT COALESCE(SUM(
    CASE
        WHEN account.balance_class = 'liability' THEN -posting.amount
        ELSE posting.amount
    END
), 0)::bigint AS coverage
FROM postings posting
JOIN financial_accounts account ON account.id = posting.financial_account_id
WHERE posting.transaction_id = $1;

-- name: DeleteTransactionBucketEntries :exec
DELETE FROM bucket_entries
WHERE transaction_id = $1;
