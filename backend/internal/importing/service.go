package importing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
	"github.com/kanishkdudeja/money-matrix/backend/internal/ledger"
)

var ErrImportedRowNotFound = errors.New("imported row not found")

type Transactor interface {
	WithinTransaction(context.Context, func(*dbgen.Queries) error) error
}

type Service struct {
	tx Transactor
}

func New(tx Transactor) *Service { return &Service{tx: tx} }

type Row struct {
	ID          string
	SourceRow   int32
	RawData     []byte
	Date        time.Time
	Description string
	Reference   string
	Amount      int64
	Balance     *int64
	Fingerprint string
	ParseError  string
}

type UploadCommand struct {
	BatchID   string
	AccountID string
	ProfileID *string
	FileName  string
	FileHash  string
	Rows      []Row
}

type UploadResult struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Imported   int    `json:"imported"`
	Duplicates int    `json:"duplicates"`
	Invalid    int    `json:"invalid"`
}

func (s *Service) CommitCSV(ctx context.Context, command UploadCommand) (UploadResult, error) {
	batchID, err := parseUUID(command.BatchID)
	if err != nil {
		return UploadResult{}, fmt.Errorf("invalid generated batch ID: %w", err)
	}
	accountID, err := parseUUID(command.AccountID)
	if err != nil {
		return UploadResult{}, fmt.Errorf("invalid account ID: %w", err)
	}
	var profileID pgtype.UUID
	if command.ProfileID != nil {
		profileID, err = parseUUID(*command.ProfileID)
		if err != nil {
			return UploadResult{}, fmt.Errorf("invalid profile ID: %w", err)
		}
	}

	result := UploadResult{ID: command.BatchID}
	err = s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		result.Status = ""
		result.Imported, result.Duplicates, result.Invalid = 0, 0, 0
		account, err := q.GetFinancialCoverageTarget(ctx, accountID)
		if err != nil {
			return fmt.Errorf("get import account: %w", err)
		}
		if err := q.CreateImportBatch(ctx, dbgen.CreateImportBatchParams{
			ID:                 batchID,
			FinancialAccountID: accountID,
			ParserProfileID:    profileID,
			FileName:           command.FileName,
			FileHash:           command.FileHash,
		}); err != nil {
			return fmt.Errorf("create import batch: %w", err)
		}

		for _, row := range command.Rows {
			rowID, err := parseUUID(row.ID)
			if err != nil {
				return fmt.Errorf("invalid generated row ID: %w", err)
			}
			params := dbgen.CreateImportedRowParams{
				ID:            rowID,
				ImportBatchID: batchID,
				SourceRow:     row.SourceRow,
				RawData:       row.RawData,
				Description:   optionalText(row.Description),
				Reference:     optionalText(row.Reference),
				ParseErrors:   []byte("[]"),
			}
			if row.ParseError != "" {
				params.ParseErrors = mustErrorsJSON(row.ParseError)
				params.ReviewStatus = "invalid"
				if err := q.CreateImportedRow(ctx, params); err != nil {
					return fmt.Errorf("create invalid imported row: %w", err)
				}
				result.Invalid++
				continue
			}

			params.TransactionDate = pgtype.Date{Time: row.Date, Valid: true}
			params.Amount = pgtype.Int8{Int64: row.Amount, Valid: true}
			if row.Balance != nil {
				params.Balance = pgtype.Int8{Int64: *row.Balance, Valid: true}
			}
			params.Fingerprint = pgtype.Text{String: row.Fingerprint, Valid: true}
			exists, err := q.ImportedRowFingerprintExists(ctx, dbgen.ImportedRowFingerprintExistsParams{
				FinancialAccountID: accountID,
				Fingerprint:        params.Fingerprint,
			})
			if err != nil {
				return fmt.Errorf("check imported row fingerprint: %w", err)
			}
			if exists {
				params.ReviewStatus = "duplicate"
				if err := q.CreateImportedRow(ctx, params); err != nil {
					return fmt.Errorf("create duplicate imported row: %w", err)
				}
				result.Duplicates++
				continue
			}

			postingAmount, err := postingAmountForCoverage(row.Amount, account.BalanceClass)
			if err != nil {
				params.ParseErrors = mustErrorsJSON(err.Error())
				params.ReviewStatus = "invalid"
				if err := q.CreateImportedRow(ctx, params); err != nil {
					return fmt.Errorf("create invalid imported row: %w", err)
				}
				result.Invalid++
				continue
			}

			transactionID, err := ledger.CreateWithQueries(ctx, q, ledger.CreateCommand{
				OccurredOn:  row.Date,
				Description: row.Description,
				Kind:        kindForAmount(row.Amount),
				Origin:      "import",
				Postings:    []ledger.PostingInput{{AccountID: command.AccountID, Amount: postingAmount}},
			})
			if errors.Is(err, ledger.ErrInvalid) {
				params.ParseErrors = mustErrorsJSON(err.Error())
				params.ReviewStatus = "invalid"
				if err := q.CreateImportedRow(ctx, params); err != nil {
					return fmt.Errorf("create invalid imported row: %w", err)
				}
				result.Invalid++
				continue
			}
			if err != nil {
				return err
			}
			params.TransactionID = transactionID
			params.ReviewStatus = "pending"
			if err := q.CreateImportedRow(ctx, params); err != nil {
				return fmt.Errorf("create imported row: %w", err)
			}
			result.Imported++
		}

		switch {
		case result.Imported > 0:
			result.Status = "ready"
		case result.Invalid > 0:
			result.Status = "failed"
		default:
			result.Status = "completed"
		}
		finish := dbgen.FinishImportBatchParams{ID: batchID, Status: result.Status}
		if result.Invalid > 0 {
			finish.ErrorDetail = pgtype.Text{String: fmt.Sprintf("%d rows could not be imported", result.Invalid), Valid: true}
		}
		if err := q.FinishImportBatch(ctx, finish); err != nil {
			return fmt.Errorf("finish import batch: %w", err)
		}
		return nil
	})
	return result, err
}

type ReviewResult struct {
	RowID         string
	TransactionID string
}

func (s *Service) Review(ctx context.Context, rowID string, command ledger.ClassificationCommand) (ReviewResult, error) {
	parsedRowID, err := parseUUID(rowID)
	if err != nil {
		return ReviewResult{}, ErrImportedRowNotFound
	}
	var transactionID pgtype.UUID
	err = s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		var err error
		transactionID, err = q.GetImportedRowTransactionForReview(ctx, parsedRowID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrImportedRowNotFound
		}
		if err != nil {
			return fmt.Errorf("get imported row transaction: %w", err)
		}
		if err := ledger.ReplaceClassificationWithQueries(ctx, q, transactionID, command); err != nil {
			return err
		}
		if err := q.MarkImportedRowReviewed(ctx, parsedRowID); err != nil {
			return fmt.Errorf("mark imported row reviewed: %w", err)
		}
		if err := q.CompleteImportBatchIfReady(ctx, parsedRowID); err != nil {
			return fmt.Errorf("complete import batch: %w", err)
		}
		return nil
	})
	return ReviewResult{RowID: rowID, TransactionID: uuidString(transactionID)}, err
}

func (s *Service) Skip(ctx context.Context, rowID string) error {
	parsedRowID, err := parseUUID(rowID)
	if err != nil {
		return ErrImportedRowNotFound
	}
	return s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		if _, err := q.MarkImportedRowSkipped(ctx, parsedRowID); errors.Is(err, pgx.ErrNoRows) {
			return ErrImportedRowNotFound
		} else if err != nil {
			return fmt.Errorf("skip imported row: %w", err)
		}
		if err := q.CompleteImportBatchIfReady(ctx, parsedRowID); err != nil {
			return fmt.Errorf("complete import batch: %w", err)
		}
		return nil
	})
}

func parseUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	if err := result.Scan(value); err != nil || !result.Valid {
		return pgtype.UUID{}, errors.New("invalid UUID")
	}
	return result, nil
}

func uuidString(value pgtype.UUID) string {
	if !value.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", value.Bytes[0:4], value.Bytes[4:6], value.Bytes[6:8], value.Bytes[8:10], value.Bytes[10:16])
}

func optionalText(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: value != ""}
}

func kindForAmount(amount int64) string {
	if amount > 0 {
		return "income"
	}
	return "expense"
}

func postingAmountForCoverage(amount int64, balanceClass string) (int64, error) {
	if balanceClass != "liability" {
		return amount, nil
	}
	if amount == math.MinInt64 {
		return 0, errors.New("liability posting amount is outside the supported range")
	}
	return -amount, nil
}

func mustErrorsJSON(message string) []byte {
	result, _ := json.Marshal([]string{message})
	return result
}
