package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
)

// Transactor runs database-only callbacks atomically. A callback may be retried
// after a serialization failure, so it must not perform external side effects.
// The Queries value is scoped to that transaction and must not escape it.
type Transactor struct {
	pool    *pgxpool.Pool
	queries *dbgen.Queries
}

func NewTransactor(pool *pgxpool.Pool, queries *dbgen.Queries) *Transactor {
	return &Transactor{pool: pool, queries: queries}
}

func (t *Transactor) WithinTransaction(
	ctx context.Context,
	fn func(*dbgen.Queries) error,
) error {
	const maxAttempts = 3
	for attempt := 0; attempt < maxAttempts; attempt++ {
		err := pgx.BeginTxFunc(
			ctx,
			t.pool,
			pgx.TxOptions{IsoLevel: pgx.Serializable},
			func(tx pgx.Tx) error {
				return fn(t.queries.WithTx(tx))
			},
		)
		if err == nil || !isRetryableTransactionError(err) || attempt == maxAttempts-1 {
			return err
		}
		timer := time.NewTimer(time.Duration(attempt+1) * 10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return nil
}

func isRetryableTransactionError(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && (postgresError.Code == "40001" || postgresError.Code == "40P01")
}
