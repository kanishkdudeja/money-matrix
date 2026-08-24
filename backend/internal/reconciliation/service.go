package reconciliation

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
	"github.com/kanishkdudeja/money-matrix/backend/internal/id"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrAccountNotFound = errors.New("financial account not found")
	ErrNotFound        = errors.New("reconciliation not found")
	ErrDoesNotBalance  = errors.New("reconciliation does not balance")
	ErrOpenExists      = errors.New("an open reconciliation already exists")
	ErrOutOfOrder      = errors.New("reconciliation statement date is out of order")
	ErrInvalidState    = errors.New("invalid reconciliation state transition")
	ErrAmountOverflow  = errors.New("reconciliation amount overflow")
)

type Transactor interface {
	WithinTransaction(context.Context, func(*dbgen.Queries) error) error
}

type Service struct {
	queries *dbgen.Queries
	tx      Transactor
}

type CreateCommand struct {
	FinancialAccountID string
	StatementDate      time.Time
	StatementBalance   int64
	Complete           bool
}

type Result struct {
	ID               string `json:"id"`
	Status           string `json:"status"`
	ComputedBalance  string `json:"computedBalance"`
	StatementBalance string `json:"statementBalance"`
	Difference       string `json:"difference"`
}

type Item struct {
	ID                 string     `json:"id"`
	FinancialAccountID string     `json:"financialAccountId"`
	StatementDate      string     `json:"statementDate"`
	StatementBalance   string     `json:"statementBalance"`
	ComputedBalance    string     `json:"computedBalance"`
	Difference         string     `json:"difference"`
	Status             string     `json:"status"`
	CompletedAt        *time.Time `json:"completedAt"`
}

func New(queries *dbgen.Queries, tx Transactor) *Service {
	return &Service{queries: queries, tx: tx}
}

func (s *Service) Create(ctx context.Context, command CreateCommand) (Result, error) {
	accountID, err := parseUUID(command.FinancialAccountID)
	if err != nil {
		return Result{}, ErrAccountNotFound
	}
	statementDate := pgtype.Date{Time: command.StatementDate, Valid: true}
	var result Result
	err = s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		if _, err := q.LockReconciliationAccount(ctx, accountID); errors.Is(err, pgx.ErrNoRows) {
			return ErrAccountNotFound
		} else if err != nil {
			return fmt.Errorf("lock reconciliation account: %w", err)
		}
		if err := ensureNoOtherOpen(ctx, q, accountID, pgtype.UUID{}); err != nil {
			return err
		}
		if err := ensureAfterLatestCompleted(ctx, q, accountID, statementDate, pgtype.UUID{}); err != nil {
			return err
		}

		reconciliationID := mustUUID(id.New())
		if err := q.CreateReconciliation(ctx, dbgen.CreateReconciliationParams{
			ID:                 reconciliationID,
			FinancialAccountID: accountID,
			StatementDate:      statementDate,
			StatementBalance:   command.StatementBalance,
			Status:             "in_progress",
		}); err != nil {
			return fmt.Errorf("create reconciliation: %w", err)
		}

		state := lockedReconciliation{
			ID:               reconciliationID,
			AccountID:        accountID,
			StatementDate:    statementDate,
			StatementBalance: command.StatementBalance,
			Status:           "in_progress",
		}
		var err error
		if command.Complete {
			result, err = completeLocked(ctx, q, state)
			return err
		}
		result, err = resultForLocked(ctx, q, state)
		return err
	})
	return result, err
}

func (s *Service) Complete(ctx context.Context, reconciliationID string) (Result, error) {
	parsedID, err := parseUUID(reconciliationID)
	if err != nil {
		return Result{}, ErrNotFound
	}
	var result Result
	err = s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		state, err := lockReconciliation(ctx, q, parsedID)
		if err != nil {
			return err
		}
		if state.Status != "in_progress" && state.Status != "reopened" {
			return fmt.Errorf("%w: only an open reconciliation can be completed", ErrInvalidState)
		}
		if err := ensureNoOtherOpen(ctx, q, state.AccountID, state.ID); err != nil {
			return err
		}
		if err := ensureAfterLatestCompleted(ctx, q, state.AccountID, state.StatementDate, state.ID); err != nil {
			return err
		}
		result, err = completeLocked(ctx, q, state)
		return err
	})
	return result, err
}

func (s *Service) Reopen(ctx context.Context, reconciliationID string) (Result, error) {
	parsedID, err := parseUUID(reconciliationID)
	if err != nil {
		return Result{}, ErrNotFound
	}
	var result Result
	err = s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		state, err := lockReconciliation(ctx, q, parsedID)
		if err != nil {
			return err
		}
		if state.Status != "completed" {
			return fmt.Errorf("%w: only a completed reconciliation can be reopened", ErrInvalidState)
		}
		if err := ensureNoOtherOpen(ctx, q, state.AccountID, state.ID); err != nil {
			return err
		}
		latest, err := q.GetLatestCompletedReconciliation(ctx, dbgen.GetLatestCompletedReconciliationParams{
			FinancialAccountID: state.AccountID,
		})
		if err != nil {
			return fmt.Errorf("get latest completed reconciliation: %w", err)
		}
		if latest.ID != state.ID {
			return fmt.Errorf("%w: only the latest completed reconciliation can be reopened", ErrOutOfOrder)
		}
		if err := q.DeleteReconciliationPostings(ctx, state.ID); err != nil {
			return fmt.Errorf("release reconciliation postings: %w", err)
		}
		if err := q.ReopenReconciliation(ctx, state.ID); err != nil {
			return fmt.Errorf("reopen reconciliation: %w", err)
		}
		state.Status = "reopened"
		result, err = resultForLocked(ctx, q, state)
		return err
	})
	return result, err
}

func (s *Service) Discard(ctx context.Context, reconciliationID string) error {
	parsedID, err := parseUUID(reconciliationID)
	if err != nil {
		return ErrNotFound
	}
	return s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		state, err := lockReconciliation(ctx, q, parsedID)
		if err != nil {
			return err
		}
		if state.Status != "in_progress" {
			return fmt.Errorf("%w: only a new in-progress reconciliation can be discarded", ErrInvalidState)
		}
		if err := q.DeleteDraftReconciliation(ctx, state.ID); err != nil {
			return fmt.Errorf("discard reconciliation: %w", err)
		}
		return nil
	})
}

type lockedReconciliation struct {
	ID               pgtype.UUID
	AccountID        pgtype.UUID
	StatementDate    pgtype.Date
	StatementBalance int64
	Status           string
}

func lockReconciliation(ctx context.Context, q *dbgen.Queries, reconciliationID pgtype.UUID) (lockedReconciliation, error) {
	row, err := q.LockReconciliation(ctx, reconciliationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return lockedReconciliation{}, ErrNotFound
	}
	if err != nil {
		return lockedReconciliation{}, fmt.Errorf("lock reconciliation: %w", err)
	}
	return lockedReconciliation{
		ID:               row.ID,
		AccountID:        row.FinancialAccountID,
		StatementDate:    row.StatementDate,
		StatementBalance: row.StatementBalance,
		Status:           row.Status,
	}, nil
}

func ensureNoOtherOpen(ctx context.Context, q *dbgen.Queries, accountID, excludeID pgtype.UUID) error {
	_, err := q.GetOpenReconciliation(ctx, dbgen.GetOpenReconciliationParams{
		FinancialAccountID: accountID,
		ExcludeID:          excludeID,
	})
	if err == nil {
		return ErrOpenExists
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return fmt.Errorf("get open reconciliation: %w", err)
}

func ensureAfterLatestCompleted(ctx context.Context, q *dbgen.Queries, accountID pgtype.UUID, statementDate pgtype.Date, excludeID pgtype.UUID) error {
	latest, err := q.GetLatestCompletedReconciliation(ctx, dbgen.GetLatestCompletedReconciliationParams{
		FinancialAccountID: accountID,
		ExcludeID:          excludeID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("get latest completed reconciliation: %w", err)
	}
	if !statementDate.Time.After(latest.StatementDate.Time) {
		return fmt.Errorf("%w: statement date must be after %s", ErrOutOfOrder, latest.StatementDate.Time.Format(time.DateOnly))
	}
	return nil
}

func completeLocked(ctx context.Context, q *dbgen.Queries, state lockedReconciliation) (Result, error) {
	result, err := resultForLocked(ctx, q, state)
	if err != nil {
		return Result{}, err
	}
	if result.Difference != "0" {
		return Result{}, fmt.Errorf("%w: computed balance differs by %s minor units", ErrDoesNotBalance, result.Difference)
	}
	if err := q.CaptureReconciliationPostings(ctx, dbgen.CaptureReconciliationPostingsParams{
		ReconciliationID:   state.ID,
		FinancialAccountID: state.AccountID,
		OccurredOn:         state.StatementDate,
	}); err != nil {
		return Result{}, fmt.Errorf("capture reconciliation postings: %w", err)
	}
	if err := q.CompleteReconciliation(ctx, state.ID); err != nil {
		return Result{}, fmt.Errorf("complete reconciliation: %w", err)
	}
	result.Status = "completed"
	return result, nil
}

func resultForLocked(ctx context.Context, q *dbgen.Queries, state lockedReconciliation) (Result, error) {
	computed, err := q.ComputeReconciliationBalance(ctx, dbgen.ComputeReconciliationBalanceParams{
		FinancialAccountID: state.AccountID,
		OccurredOn:         state.StatementDate,
	})
	if err != nil {
		return Result{}, fmt.Errorf("compute reconciliation balance: %w", err)
	}
	difference, ok := checkedSubtract(computed, state.StatementBalance)
	if !ok {
		return Result{}, ErrAmountOverflow
	}
	return Result{
		ID:               uuidString(state.ID),
		Status:           state.Status,
		ComputedBalance:  fmt.Sprint(computed),
		StatementBalance: fmt.Sprint(state.StatementBalance),
		Difference:       fmt.Sprint(difference),
	}, nil
}

func checkedSubtract(left, right int64) (int64, bool) {
	if (right > 0 && left < math.MinInt64+right) || (right < 0 && left > math.MaxInt64+right) {
		return 0, false
	}
	return left - right, true
}

func (s *Service) List(ctx context.Context) ([]Item, error) {
	rows, err := s.queries.ListReconciliations(ctx)
	if err != nil {
		return nil, fmt.Errorf("list reconciliations: %w", err)
	}
	items := make([]Item, 0, len(rows))
	for _, row := range rows {
		difference, ok := checkedSubtract(row.ComputedBalance, row.StatementBalance)
		if !ok {
			return nil, ErrAmountOverflow
		}
		item := Item{
			ID:                 uuidString(row.ID),
			FinancialAccountID: uuidString(row.FinancialAccountID),
			StatementDate:      row.StatementDate.Time.Format(time.DateOnly),
			StatementBalance:   fmt.Sprint(row.StatementBalance),
			ComputedBalance:    fmt.Sprint(row.ComputedBalance),
			Difference:         fmt.Sprint(difference),
			Status:             row.Status,
		}
		if row.CompletedAt.Valid {
			completed := row.CompletedAt.Time
			item.CompletedAt = &completed
		}
		items = append(items, item)
	}
	return items, nil
}

func parseUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	if err := result.Scan(value); err != nil || !result.Valid {
		return pgtype.UUID{}, errors.New("invalid UUID")
	}
	return result, nil
}

func mustUUID(value string) pgtype.UUID {
	result, err := parseUUID(value)
	if err != nil {
		panic(fmt.Errorf("parse generated UUID: %w", err))
	}
	return result
}

func uuidString(value pgtype.UUID) string {
	if !value.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", value.Bytes[0:4], value.Bytes[4:6], value.Bytes[6:8], value.Bytes[8:10], value.Bytes[10:16])
}
