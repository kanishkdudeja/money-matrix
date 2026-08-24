package ledger

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
	"github.com/kanishkdudeja/money-matrix/backend/internal/id"
)

var (
	ErrInvalid         = errors.New("invalid transaction")
	ErrNotFound        = errors.New("transaction not found")
	ErrAlreadyReversed = errors.New("transaction already reversed")
	ErrImmutable       = errors.New("transaction entries are immutable")
)

const unallocatedBucketID = "00000000-0000-0000-0000-000000000001"

type PostingInput struct {
	AccountID string
	Amount    int64
	Memo      *string
}

// BucketEntryInput is one signed bucket effect. CategoryID classifies that
// exact amount when known; BucketID is always required.
type BucketEntryInput struct {
	BucketID   string
	CategoryID *string
	Amount     int64
	Memo       *string
}

type CreateCommand struct {
	OccurredOn    time.Time
	Description   string
	Kind          string
	Origin        string
	Postings      []PostingInput
	BucketEntries []BucketEntryInput
}

// ClassificationCommand is the complete replacement bucket breakdown for an
// existing financial transaction. Categories are carried by individual bucket
// entries, so the category and bucket views can never disagree about a split.
type ClassificationCommand struct {
	BucketEntries []BucketEntryInput
}

type targetPolicy uint8

const (
	requireActiveTargets targetPolicy = iota
	allowHistoricalTargets
)

type createOptions struct {
	targetPolicy targetPolicy
	reversalOf   pgtype.UUID
}

type Posting struct {
	ID        string  `json:"id"`
	AccountID string  `json:"accountId"`
	Amount    string  `json:"amount"`
	Memo      *string `json:"memo,omitempty"`
}

type BucketEntry struct {
	ID         string  `json:"id"`
	BucketID   string  `json:"bucketId"`
	CategoryID *string `json:"categoryId,omitempty"`
	Amount     string  `json:"amount"`
	Memo       *string `json:"memo,omitempty"`
}

type Transaction struct {
	ID            string        `json:"id"`
	OccurredOn    string        `json:"occurredOn"`
	Description   string        `json:"description"`
	Kind          string        `json:"kind"`
	Status        string        `json:"status"`
	Origin        string        `json:"origin"`
	ReversalOfID  *string       `json:"reversalOfId,omitempty"`
	Postings      []Posting     `json:"postings"`
	BucketEntries []BucketEntry `json:"bucketEntries"`
}

// Transactor is defined by the service that consumes it. The PostgreSQL
// implementation lives in internal/database.
type Transactor interface {
	WithinTransaction(context.Context, func(*dbgen.Queries) error) error
}

type Service struct {
	queries *dbgen.Queries
	tx      Transactor
}

func New(queries *dbgen.Queries, tx Transactor) *Service {
	return &Service{queries: queries, tx: tx}
}

func (s *Service) Create(ctx context.Context, command CreateCommand) (Transaction, error) {
	var result Transaction
	err := s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		transactionID, err := CreateWithQueries(ctx, q, command)
		if err != nil {
			return err
		}
		result, err = getWithQueries(ctx, q, transactionID)
		return err
	})
	return result, err
}

// CreateWithQueries lets a larger database-only workflow create a valid ledger
// event inside its existing transaction.
func CreateWithQueries(ctx context.Context, q *dbgen.Queries, command CreateCommand) (pgtype.UUID, error) {
	return createWithQueries(ctx, q, command, createOptions{targetPolicy: requireActiveTargets})
}

func createWithQueries(ctx context.Context, q *dbgen.Queries, command CreateCommand, options createOptions) (pgtype.UUID, error) {
	command.Description = strings.TrimSpace(command.Description)
	if err := validateCommand(command); err != nil {
		return pgtype.UUID{}, err
	}

	if command.Kind == "bucket_transfer" {
		total, sumErr := sumBucketEntries(command.BucketEntries)
		if len(command.Postings) != 0 || hasCategorizedEntry(command.BucketEntries) || len(command.BucketEntries) < 2 || distinctBuckets(command.BucketEntries) < 2 || sumErr != nil || total != 0 {
			return pgtype.UUID{}, fmt.Errorf("%w: bucket transfers require no postings or categories and at least two distinct, balanced bucket entries", ErrInvalid)
		}
	} else if len(command.Postings) == 0 {
		return pgtype.UUID{}, fmt.Errorf("%w: financial transactions require at least one posting", ErrInvalid)
	}

	coverage, err := financialCoverage(ctx, q, command.OccurredOn, command.Postings, options.targetPolicy)
	if err != nil {
		return pgtype.UUID{}, err
	}
	if command.Kind != "bucket_transfer" && len(command.BucketEntries) == 0 && coverage != 0 {
		command.BucketEntries = []BucketEntryInput{{BucketID: unallocatedBucketID, Amount: coverage}}
	}
	bucketTotal, err := sumBucketEntries(command.BucketEntries)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("%w: bucket entry total overflow", ErrInvalid)
	}
	if bucketTotal != coverage {
		return pgtype.UUID{}, fmt.Errorf("%w: bucket entries total %d, financial coverage change is %d", ErrInvalid, bucketTotal, coverage)
	}
	if err := validateBucketEntryTargets(ctx, q, command.BucketEntries, options.targetPolicy); err != nil {
		return pgtype.UUID{}, err
	}

	transactionID := mustUUID(id.New())
	if _, err := q.CreateTransaction(ctx, dbgen.CreateTransactionParams{
		ID: transactionID, OccurredOn: pgtype.Date{Time: command.OccurredOn, Valid: true},
		Description: command.Description, Kind: command.Kind, Status: "posted", Origin: command.Origin,
		ReversalOfID: options.reversalOf,
	}); err != nil {
		return pgtype.UUID{}, fmt.Errorf("create transaction: %w", err)
	}
	if err := insertPostings(ctx, q, transactionID, command.Postings); err != nil {
		return pgtype.UUID{}, err
	}
	if err := insertBucketEntries(ctx, q, transactionID, command.BucketEntries); err != nil {
		return pgtype.UUID{}, err
	}
	return transactionID, nil
}

// ReplaceClassificationWithQueries atomically replaces the complete bucket
// breakdown of a posted financial transaction. Reversed transactions can never
// be changed.
func ReplaceClassificationWithQueries(ctx context.Context, q *dbgen.Queries, transactionID pgtype.UUID, command ClassificationCommand) error {
	parent, err := q.LockTransactionForClassification(ctx, transactionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("lock transaction for classification: %w", err)
	}
	if parent.Status != "posted" {
		return fmt.Errorf("%w: only posted transactions can be reclassified", ErrImmutable)
	}
	if parent.Kind == "bucket_transfer" {
		return fmt.Errorf("%w: bucket transfers do not have financial classification", ErrInvalid)
	}

	coverage, err := q.GetTransactionFinancialCoverage(ctx, transactionID)
	if err != nil {
		return fmt.Errorf("get transaction coverage: %w", err)
	}
	if len(command.BucketEntries) == 0 && coverage != 0 {
		command.BucketEntries = []BucketEntryInput{{BucketID: unallocatedBucketID, Amount: coverage}}
	}
	total, err := sumBucketEntries(command.BucketEntries)
	if err != nil {
		return fmt.Errorf("%w: bucket entry total overflow", ErrInvalid)
	}
	if total != coverage {
		return fmt.Errorf("%w: bucket entries must equal the financial coverage change", ErrInvalid)
	}
	if err := validateBucketEntryInputs(command.BucketEntries); err != nil {
		return err
	}
	if err := validateBucketEntryTargets(ctx, q, command.BucketEntries, requireActiveTargets); err != nil {
		return err
	}
	if err := q.DeleteTransactionBucketEntries(ctx, transactionID); err != nil {
		return fmt.Errorf("delete bucket entries: %w", err)
	}
	return insertBucketEntries(ctx, q, transactionID, command.BucketEntries)
}

func (s *Service) Get(ctx context.Context, transactionID string) (Transaction, error) {
	parsed, err := parseUUID(transactionID)
	if err != nil {
		return Transaction{}, ErrNotFound
	}
	return getWithQueries(ctx, s.queries, parsed)
}

func (s *Service) List(ctx context.Context, limit, offset int) ([]Transaction, error) {
	rows, err := s.queries.ListTransactionDetails(ctx, dbgen.ListTransactionDetailsParams{Limit: int32(limit), Offset: int32(offset)})
	if err != nil {
		return nil, fmt.Errorf("list transactions: %w", err)
	}
	items := make([]Transaction, 0, len(rows))
	for _, row := range rows {
		item, err := mapTransaction(row.ID, row.OccurredOn, row.Description, row.Kind, row.Status, row.Origin, row.ReversalOfID, row.Postings, row.BucketEntries)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *Service) Reverse(ctx context.Context, transactionID, description string) (Transaction, error) {
	parsedID, err := parseUUID(transactionID)
	if err != nil {
		return Transaction{}, ErrNotFound
	}
	var result Transaction
	err = s.tx.WithinTransaction(ctx, func(q *dbgen.Queries) error {
		status, err := q.LockTransactionForReversal(ctx, parsedID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock transaction for reversal: %w", err)
		}
		if status == "reversed" {
			return ErrAlreadyReversed
		}
		original, err := getWithQueries(ctx, q, parsedID)
		if err != nil {
			return err
		}
		command, err := reversalCommand(original, description)
		if err != nil {
			return err
		}
		reversalID, err := createWithQueries(ctx, q, command, createOptions{targetPolicy: allowHistoricalTargets, reversalOf: parsedID})
		if err != nil {
			return err
		}
		if err := q.MarkTransactionReversed(ctx, parsedID); err != nil {
			return fmt.Errorf("mark transaction reversed: %w", err)
		}
		result, err = getWithQueries(ctx, q, reversalID)
		return err
	})
	return result, err
}

func reversalCommand(original Transaction, description string) (CreateCommand, error) {
	command := CreateCommand{OccurredOn: time.Now().UTC(), Description: strings.TrimSpace(description), Kind: original.Kind, Origin: "manual"}
	if command.Description == "" {
		command.Description = "Reversal"
	}
	for _, posting := range original.Postings {
		amount, err := negatedAmount(posting.Amount)
		if err != nil {
			return CreateCommand{}, err
		}
		command.Postings = append(command.Postings, PostingInput{AccountID: posting.AccountID, Amount: amount, Memo: posting.Memo})
	}
	for _, entry := range original.BucketEntries {
		amount, err := negatedAmount(entry.Amount)
		if err != nil {
			return CreateCommand{}, err
		}
		command.BucketEntries = append(command.BucketEntries, BucketEntryInput{BucketID: entry.BucketID, CategoryID: entry.CategoryID, Amount: amount, Memo: entry.Memo})
	}
	return command, nil
}

func negatedAmount(value string) (int64, error) {
	amount, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse stored amount: %w", err)
	}
	if amount == math.MinInt64 {
		return 0, fmt.Errorf("%w: amount cannot be negated", ErrInvalid)
	}
	return -amount, nil
}

func getWithQueries(ctx context.Context, q *dbgen.Queries, transactionID pgtype.UUID) (Transaction, error) {
	row, err := q.GetTransactionDetails(ctx, transactionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Transaction{}, ErrNotFound
	}
	if err != nil {
		return Transaction{}, fmt.Errorf("get transaction: %w", err)
	}
	return mapTransaction(row.ID, row.OccurredOn, row.Description, row.Kind, row.Status, row.Origin, row.ReversalOfID, row.Postings, row.BucketEntries)
}

func mapTransaction(idValue pgtype.UUID, date pgtype.Date, description, kind, status, origin string, reversalID pgtype.UUID, postingsJSON, bucketEntriesJSON string) (Transaction, error) {
	result := Transaction{ID: uuidString(idValue), OccurredOn: date.Time.Format(time.DateOnly), Description: description, Kind: kind, Status: status, Origin: origin}
	if reversalID.Valid {
		value := uuidString(reversalID)
		result.ReversalOfID = &value
	}
	if err := json.Unmarshal([]byte(postingsJSON), &result.Postings); err != nil {
		return Transaction{}, fmt.Errorf("decode postings: %w", err)
	}
	if err := json.Unmarshal([]byte(bucketEntriesJSON), &result.BucketEntries); err != nil {
		return Transaction{}, fmt.Errorf("decode bucket entries: %w", err)
	}
	return result, nil
}

func validateCommand(command CreateCommand) error {
	if command.OccurredOn.IsZero() || command.Description == "" {
		return fmt.Errorf("%w: date and description are required", ErrInvalid)
	}
	if !contains(command.Kind, "income", "expense", "transfer", "refund", "adjustment", "opening_balance", "bucket_transfer") {
		return fmt.Errorf("%w: unsupported kind", ErrInvalid)
	}
	if !contains(command.Origin, "manual", "import", "recurring_rule", "system") {
		return fmt.Errorf("%w: unsupported origin", ErrInvalid)
	}
	if err := validatePostingInputs(command.Postings); err != nil {
		return err
	}
	return validateBucketEntryInputs(command.BucketEntries)
}

func validatePostingInputs(entries []PostingInput) error {
	for _, entry := range entries {
		if entry.AccountID == "" || entry.Amount == 0 {
			return fmt.Errorf("%w: posting account and non-zero amount are required", ErrInvalid)
		}
	}
	return nil
}

func validateBucketEntryInputs(entries []BucketEntryInput) error {
	for _, entry := range entries {
		if entry.BucketID == "" || entry.Amount == 0 {
			return fmt.Errorf("%w: bucket and non-zero amount are required", ErrInvalid)
		}
		if entry.CategoryID != nil && *entry.CategoryID == "" {
			return fmt.Errorf("%w: category ID cannot be empty", ErrInvalid)
		}
	}
	return nil
}

func financialCoverage(ctx context.Context, q *dbgen.Queries, occurredOn time.Time, entries []PostingInput, policy targetPolicy) (int64, error) {
	var total int64
	for _, entry := range entries {
		targetID, err := parseUUID(entry.AccountID)
		if err != nil {
			return 0, fmt.Errorf("%w: invalid financial account ID", ErrInvalid)
		}
		target, err := q.GetFinancialCoverageTarget(ctx, targetID)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, fmt.Errorf("%w: financial account %s not found", ErrInvalid, entry.AccountID)
		}
		if err != nil {
			return 0, fmt.Errorf("get financial account: %w", err)
		}
		if target.Archived && policy == requireActiveTargets {
			return 0, fmt.Errorf("%w: financial account %s is archived", ErrInvalid, entry.AccountID)
		}
		if target.ReconciledThrough.Valid && !occurredOn.After(target.ReconciledThrough.Time) {
			return 0, fmt.Errorf("%w: transaction would alter a reconciled period ending %s", ErrInvalid, target.ReconciledThrough.Time.Format(time.DateOnly))
		}
		amount := entry.Amount
		if target.BalanceClass == "liability" {
			if amount == math.MinInt64 {
				return 0, fmt.Errorf("%w: coverage overflow", ErrInvalid)
			}
			amount = -amount
		}
		var ok bool
		total, ok = checkedAdd(total, amount)
		if !ok {
			return 0, fmt.Errorf("%w: coverage overflow", ErrInvalid)
		}
	}
	return total, nil
}

func validateBucketEntryTargets(ctx context.Context, q *dbgen.Queries, entries []BucketEntryInput, policy targetPolicy) error {
	for _, entry := range entries {
		bucketID, err := parseUUID(entry.BucketID)
		if err != nil {
			return fmt.Errorf("%w: invalid bucket ID", ErrInvalid)
		}
		archived, err := q.GetBucketTarget(ctx, bucketID)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: bucket %s not found", ErrInvalid, entry.BucketID)
		}
		if err != nil {
			return fmt.Errorf("get bucket: %w", err)
		}
		if archived && policy == requireActiveTargets {
			return fmt.Errorf("%w: bucket %s is archived", ErrInvalid, entry.BucketID)
		}
		if entry.CategoryID == nil {
			continue
		}
		categoryID, err := parseUUID(*entry.CategoryID)
		if err != nil {
			return fmt.Errorf("%w: invalid category ID", ErrInvalid)
		}
		archived, err = q.GetCategoryTarget(ctx, categoryID)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: category %s not found", ErrInvalid, *entry.CategoryID)
		}
		if err != nil {
			return fmt.Errorf("get category: %w", err)
		}
		if archived && policy == requireActiveTargets {
			return fmt.Errorf("%w: category %s is archived", ErrInvalid, *entry.CategoryID)
		}
	}
	return nil
}

func insertPostings(ctx context.Context, q *dbgen.Queries, transactionID pgtype.UUID, entries []PostingInput) error {
	for position, entry := range entries {
		if position > math.MaxInt16 {
			return fmt.Errorf("%w: too many postings", ErrInvalid)
		}
		_, err := q.CreatePosting(ctx, dbgen.CreatePostingParams{ID: mustUUID(id.New()), TransactionID: transactionID, FinancialAccountID: mustUUID(entry.AccountID), Amount: entry.Amount, Position: int16(position), Memo: optionalText(entry.Memo)})
		if err != nil {
			return fmt.Errorf("create posting: %w", err)
		}
	}
	return nil
}

func insertBucketEntries(ctx context.Context, q *dbgen.Queries, transactionID pgtype.UUID, entries []BucketEntryInput) error {
	for position, entry := range entries {
		if position > math.MaxInt16 {
			return fmt.Errorf("%w: too many bucket entries", ErrInvalid)
		}
		categoryID, err := nullableUUID(entry.CategoryID)
		if err != nil {
			return fmt.Errorf("%w: invalid category ID", ErrInvalid)
		}
		_, err = q.CreateBucketEntry(ctx, dbgen.CreateBucketEntryParams{
			ID: mustUUID(id.New()), TransactionID: transactionID, BucketID: mustUUID(entry.BucketID),
			CategoryID: categoryID, Amount: entry.Amount, Position: int16(position), Memo: optionalText(entry.Memo),
		})
		if err != nil {
			return fmt.Errorf("create bucket entry: %w", err)
		}
	}
	return nil
}

func sumBucketEntries(entries []BucketEntryInput) (int64, error) {
	var total int64
	for _, entry := range entries {
		var ok bool
		total, ok = checkedAdd(total, entry.Amount)
		if !ok {
			return 0, errors.New("amount total overflow")
		}
	}
	return total, nil
}

func hasCategorizedEntry(entries []BucketEntryInput) bool {
	for _, entry := range entries {
		if entry.CategoryID != nil {
			return true
		}
	}
	return false
}

func distinctBuckets(entries []BucketEntryInput) int {
	targets := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		targets[entry.BucketID] = struct{}{}
	}
	return len(targets)
}

func checkedAdd(left, right int64) (int64, bool) {
	if (right > 0 && left > math.MaxInt64-right) || (right < 0 && left < math.MinInt64-right) {
		return 0, false
	}
	return left + right, true
}

func contains(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func parseUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	if err := result.Scan(value); err != nil || !result.Valid {
		return pgtype.UUID{}, errors.New("invalid UUID")
	}
	return result, nil
}

func nullableUUID(value *string) (pgtype.UUID, error) {
	if value == nil {
		return pgtype.UUID{}, nil
	}
	return parseUUID(*value)
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

func optionalText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}
