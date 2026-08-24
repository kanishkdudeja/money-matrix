-- name: LockReconciliationAccount :one
SELECT id
FROM financial_accounts
WHERE id = $1
FOR UPDATE;

-- name: LockReconciliation :one
SELECT
    reconciliation.id,
    reconciliation.financial_account_id,
    reconciliation.statement_date,
    reconciliation.statement_balance,
    reconciliation.status
FROM reconciliations reconciliation
JOIN financial_accounts account ON account.id = reconciliation.financial_account_id
WHERE reconciliation.id = $1
FOR UPDATE OF account, reconciliation;

-- name: GetLatestCompletedReconciliation :one
SELECT id, statement_date
FROM reconciliations
WHERE financial_account_id = $1
  AND status = 'completed'
  AND (sqlc.narg('exclude_id')::uuid IS NULL OR id <> sqlc.narg('exclude_id'))
ORDER BY statement_date DESC, created_at DESC
LIMIT 1;

-- name: GetOpenReconciliation :one
SELECT id
FROM reconciliations
WHERE financial_account_id = $1
  AND status IN ('in_progress', 'reopened')
  AND (sqlc.narg('exclude_id')::uuid IS NULL OR id <> sqlc.narg('exclude_id'))
LIMIT 1;

-- name: ComputeReconciliationBalance :one
SELECT COALESCE(SUM(p.amount), 0)::bigint AS balance
FROM postings p
JOIN transactions t ON t.id = p.transaction_id
WHERE p.financial_account_id = $1
  AND t.occurred_on <= $2
  AND t.status IN ('posted', 'reversed');

-- name: CreateReconciliation :exec
INSERT INTO reconciliations (
    id,
    financial_account_id,
    statement_date,
    statement_balance,
    status,
    completed_at
)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: CompleteReconciliation :exec
UPDATE reconciliations
SET status = 'completed',
    completed_at = now(),
    updated_at = now()
WHERE id = $1;

-- name: ReopenReconciliation :exec
UPDATE reconciliations
SET status = 'reopened',
    completed_at = NULL,
    updated_at = now()
WHERE id = $1;

-- name: DeleteDraftReconciliation :exec
DELETE FROM reconciliations
WHERE id = $1
  AND status = 'in_progress';

-- name: DeleteReconciliationPostings :exec
DELETE FROM reconciliation_postings
WHERE reconciliation_id = $1;

-- name: CaptureReconciliationPostings :exec
INSERT INTO reconciliation_postings (reconciliation_id, posting_id)
SELECT $1, p.id
FROM postings p
JOIN transactions t ON t.id = p.transaction_id
LEFT JOIN reconciliation_postings rp ON rp.posting_id = p.id
WHERE p.financial_account_id = $2
  AND t.occurred_on <= $3
  AND t.status IN ('posted', 'reversed')
  AND rp.posting_id IS NULL;

-- name: ListReconciliations :many
SELECT
    reconciliation.id,
    reconciliation.financial_account_id,
    reconciliation.statement_date,
    reconciliation.statement_balance,
    reconciliation.status,
    reconciliation.completed_at,
    COALESCE((
        SELECT SUM(posting.amount)
        FROM postings posting
        JOIN transactions transaction ON transaction.id = posting.transaction_id
        WHERE posting.financial_account_id = reconciliation.financial_account_id
          AND transaction.occurred_on <= reconciliation.statement_date
          AND transaction.status IN ('posted', 'reversed')
    ), 0)::bigint AS computed_balance
FROM reconciliations reconciliation
ORDER BY reconciliation.statement_date DESC;
