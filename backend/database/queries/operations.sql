-- name: ListCategorizationRules :many
SELECT id, name, priority, conditions, category_id, bucket_id, transaction_kind, auto_apply, enabled
FROM categorization_rules
ORDER BY priority DESC, created_at;

-- name: CreateCategorizationRule :one
INSERT INTO categorization_rules (
    id, name, priority, conditions, category_id, bucket_id, transaction_kind, auto_apply
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: DeleteCategorizationRule :execrows
DELETE FROM categorization_rules
WHERE id = $1;

-- name: GetImportedRowSuggestionSource :one
SELECT COALESCE(description, '')::text AS description,
       COALESCE(amount, 0)::bigint AS amount
FROM imported_rows
WHERE id = $1;

-- name: ListEnabledCategorizationRules :many
SELECT id, name, conditions, category_id, bucket_id, transaction_kind, auto_apply
FROM categorization_rules
WHERE enabled
  AND NOT EXISTS (SELECT 1 FROM categories WHERE id = categorization_rules.category_id AND archived_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM buckets WHERE id = categorization_rules.bucket_id AND archived_at IS NOT NULL)
ORDER BY priority DESC, created_at;

-- name: ListTransactionExportEntries :many
SELECT
    t.id AS transaction_id,
    t.occurred_on,
    t.description,
    t.kind,
    t.status,
    t.origin,
    entries.entry_type,
    entries.target_name,
    COALESCE(entries.target_kind, '')::text AS target_kind,
    entries.category_name,
    entries.amount,
    entries.memo
FROM transactions t
JOIN LATERAL (
    SELECT 'posting'::text AS entry_type, a.name AS target_name, a.kind AS target_kind,
           NULL::text AS category_name, p.amount, p.memo, p.position, 1 AS entry_order
    FROM postings p
    JOIN financial_accounts a ON a.id = p.financial_account_id
    WHERE p.transaction_id = t.id
    UNION ALL
    SELECT 'bucket', b.name, NULL::text, c.name, be.amount, be.memo, be.position, 2
    FROM bucket_entries be
    JOIN buckets b ON b.id = be.bucket_id
    LEFT JOIN categories c ON c.id = be.category_id
    WHERE be.transaction_id = t.id
) entries ON true
ORDER BY t.occurred_on, t.created_at, entries.entry_order, entries.position;
