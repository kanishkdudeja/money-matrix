package database

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestRetryableTransactionErrors(t *testing.T) {
	t.Parallel()
	for _, code := range []string{"40001", "40P01"} {
		if !isRetryableTransactionError(&pgconn.PgError{Code: code}) {
			t.Fatalf("SQLSTATE %s should be retryable", code)
		}
	}
	if isRetryableTransactionError(errors.New("ordinary failure")) {
		t.Fatal("ordinary errors must not be retried")
	}
}
