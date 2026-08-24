-- name: GetDashboard :one
WITH account_balances AS (
    SELECT
        a.balance_class,
        COALESCE(SUM(p.amount) FILTER (WHERE t.status IN ('posted', 'reversed')), 0)::bigint AS balance
    FROM financial_accounts a
    LEFT JOIN postings p ON p.financial_account_id = a.id
    LEFT JOIN transactions t ON t.id = p.transaction_id
    GROUP BY a.id
)
SELECT
    COALESCE(SUM(balance) FILTER (WHERE balance_class = 'asset'), 0)::bigint AS assets,
    COALESCE(SUM(balance) FILTER (WHERE balance_class = 'liability'), 0)::bigint AS liabilities,
    (SELECT COALESCE(SUM(be.amount) FILTER (WHERE t.status IN ('posted', 'reversed')), 0)::bigint
     FROM bucket_entries be
     JOIN transactions t ON t.id = be.transaction_id) AS buckets,
    (SELECT count(*)::bigint
     FROM imported_rows
     WHERE review_status IN ('pending', 'suggested')) AS imports_needing_review
FROM account_balances;
