-- name: GetCSVParserProfileMapping :one
SELECT mapping
FROM parser_profiles
WHERE id = $1
  AND format = 'csv';

-- name: CreateImportBatch :exec
INSERT INTO import_batches (
    id, financial_account_id, parser_profile_id, format, file_name, file_hash, status
)
VALUES ($1, $2, $3, 'csv', $4, $5, 'processing');

-- name: ImportedRowFingerprintExists :one
SELECT EXISTS (
    SELECT 1
    FROM imported_rows ir
    JOIN import_batches ib ON ib.id = ir.import_batch_id
    WHERE ib.financial_account_id = $1
      AND ir.fingerprint = $2
)::boolean;

-- name: CreateImportedRow :exec
INSERT INTO imported_rows (
    id,
    import_batch_id,
    source_row,
    raw_data,
    transaction_date,
    description,
    reference,
    amount,
    balance,
    fingerprint,
    transaction_id,
    parse_errors,
    review_status
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);

-- name: FinishImportBatch :exec
UPDATE import_batches
SET status = $2,
    updated_at = now(),
    error_detail = $3
WHERE id = $1;

-- name: GetImportedRowTransactionForReview :one
SELECT transaction_id
FROM imported_rows
WHERE id = $1
  AND transaction_id IS NOT NULL;

-- name: MarkImportedRowReviewed :exec
UPDATE imported_rows
SET review_status = 'reviewed',
    updated_at = now()
WHERE id = $1;

-- name: MarkImportedRowSkipped :one
UPDATE imported_rows
SET review_status = 'skipped',
    updated_at = now()
WHERE id = $1
  AND review_status IN ('pending', 'suggested')
RETURNING id;

-- name: CompleteImportBatchIfReady :exec
UPDATE import_batches b
SET status = 'completed',
    updated_at = now()
WHERE b.id = (SELECT source.import_batch_id FROM imported_rows source WHERE source.id = $1)
  AND NOT EXISTS (
      SELECT 1
      FROM imported_rows pending
      WHERE pending.import_batch_id = b.id
        AND pending.review_status IN ('pending', 'suggested')
  );

-- name: ListParserProfiles :many
SELECT id, name, format, institution, mapping, parser_version
FROM parser_profiles
ORDER BY name, parser_version DESC;

-- name: CreateParserProfile :one
INSERT INTO parser_profiles (id, name, format, institution, mapping, parser_version)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetImportBatch :one
SELECT id, financial_account_id, file_name, status, created_at
FROM import_batches
WHERE id = $1;

-- name: ListImportBatchSummaries :many
SELECT
    batch.id,
    batch.financial_account_id,
    batch.file_name,
    batch.status,
    batch.created_at,
    count(row.id) FILTER (WHERE row.transaction_id IS NOT NULL)::bigint AS imported,
    count(row.id) FILTER (WHERE row.review_status = 'duplicate')::bigint AS duplicates,
    count(row.id) FILTER (WHERE row.review_status = 'invalid')::bigint AS invalid,
    count(row.id) FILTER (WHERE row.review_status IN ('pending', 'suggested'))::bigint AS pending
FROM import_batches batch
LEFT JOIN imported_rows row ON row.import_batch_id = batch.id
WHERE (sqlc.narg('status')::text IS NULL OR batch.status = sqlc.narg('status'))
GROUP BY batch.id
ORDER BY batch.created_at DESC, batch.id
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');

-- name: ListImportedRows :many
SELECT
    id,
    source_row,
    transaction_date,
    description,
    reference,
    amount,
    balance,
    transaction_id,
    review_status,
    parse_errors
FROM imported_rows
WHERE import_batch_id = $1
ORDER BY source_row;
