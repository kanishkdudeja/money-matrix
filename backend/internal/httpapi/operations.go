package httpapi

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
	"github.com/kanishkdudeja/money-matrix/backend/internal/id"
	"github.com/kanishkdudeja/money-matrix/backend/internal/reconciliation"
)

type operationsAPI struct {
	queries        *dbgen.Queries
	reconciliation *reconciliation.Service
}

type ruleResponse struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Priority        int32           `json:"priority"`
	Conditions      json.RawMessage `json:"conditions"`
	CategoryID      *string         `json:"categoryId,omitempty"`
	BucketID        *string         `json:"bucketId,omitempty"`
	TransactionKind *string         `json:"transactionKind,omitempty"`
	AutoApply       bool            `json:"autoApply"`
	Enabled         bool            `json:"enabled"`
}

type ruleConditions struct {
	DescriptionContains string `json:"descriptionContains"`
	Direction           string `json:"direction"`
	MinimumAmount       *int64 `json:"minimumAmount"`
	MaximumAmount       *int64 `json:"maximumAmount"`
}

func (api operationsAPI) listRules(w http.ResponseWriter, r *http.Request) {
	rows, err := api.queries.ListCategorizationRules(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	items := make([]ruleResponse, 0, len(rows))
	for _, row := range rows {
		items = append(items, ruleResponse{
			ID:              uuidString(row.ID),
			Name:            row.Name,
			Priority:        row.Priority,
			Conditions:      row.Conditions,
			CategoryID:      uuidPointer(row.CategoryID),
			BucketID:        uuidPointer(row.BucketID),
			TransactionKind: textPointer(row.TransactionKind),
			AutoApply:       row.AutoApply,
			Enabled:         row.Enabled,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (api operationsAPI) createRule(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name            string          `json:"name"`
		Priority        int32           `json:"priority"`
		Conditions      json.RawMessage `json:"conditions"`
		CategoryID      *string         `json:"categoryId"`
		BucketID        *string         `json:"bucketId"`
		TransactionKind *string         `json:"transactionKind"`
		AutoApply       bool            `json:"autoApply"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, 400, "Invalid request", err.Error())
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Conditions) == 0 || !json.Valid(input.Conditions) {
		writeProblem(w, 422, "Validation failed", "name and valid conditions are required")
		return
	}
	if err := validateRuleConditions(input.Conditions); err != nil {
		writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", err.Error())
		return
	}
	if input.CategoryID == nil && input.BucketID == nil && input.TransactionKind == nil {
		writeProblem(w, 422, "Validation failed", "rule must suggest at least one result")
		return
	}
	categoryID, err := parseNullableUUID(input.CategoryID)
	if err != nil {
		writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "categoryId must be a UUID")
		return
	}
	bucketID, err := parseNullableUUID(input.BucketID)
	if err != nil {
		writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "bucketId must be a UUID")
		return
	}
	if input.TransactionKind != nil && !oneOf(*input.TransactionKind, "income", "expense", "transfer", "refund", "adjustment", "opening_balance", "bucket_transfer") {
		writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "unsupported transactionKind")
		return
	}
	if categoryID.Valid {
		archived, err := api.queries.GetCategoryTarget(r.Context(), categoryID)
		if err != nil || archived {
			writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "categoryId must reference an active category")
			return
		}
	}
	if bucketID.Valid {
		archived, err := api.queries.GetBucketTarget(r.Context(), bucketID)
		if err != nil || archived {
			writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "bucketId must reference an active bucket")
			return
		}
	}
	row, err := api.queries.CreateCategorizationRule(r.Context(), dbgen.CreateCategorizationRuleParams{
		ID:              mustParseUUID(id.New()),
		Name:            input.Name,
		Priority:        input.Priority,
		Conditions:      input.Conditions,
		CategoryID:      categoryID,
		BucketID:        bucketID,
		TransactionKind: optionalText(input.TransactionKind),
		AutoApply:       input.AutoApply,
	})
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ruleResponse{ID: uuidString(row.ID), Name: row.Name, Priority: row.Priority, Conditions: row.Conditions, CategoryID: uuidPointer(row.CategoryID), BucketID: uuidPointer(row.BucketID), TransactionKind: textPointer(row.TransactionKind), AutoApply: row.AutoApply, Enabled: row.Enabled})
}

func (api operationsAPI) deleteRule(w http.ResponseWriter, r *http.Request) {
	ruleID, err := parseUUID(chi.URLParam(r, "id"))
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid rule ID", "")
		return
	}
	rows, err := api.queries.DeleteCategorizationRule(r.Context(), ruleID)
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	if rows == 0 {
		writeProblem(w, http.StatusNotFound, "Rule not found", "")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api operationsAPI) suggestions(w http.ResponseWriter, r *http.Request) {
	rowID, err := parseUUID(chi.URLParam(r, "id"))
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid imported row ID", "")
		return
	}
	source, err := api.queries.GetImportedRowSuggestionSource(r.Context(), rowID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeProblem(w, http.StatusNotFound, "Imported row not found", "")
		return
	}
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	rows, err := api.queries.ListEnabledCategorizationRules(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	items := make([]map[string]any, 0)
	for _, row := range rows {
		if matchesRule(row.Conditions, source.Description, source.Amount) {
			items = append(items, map[string]any{"ruleId": uuidString(row.ID), "ruleName": row.Name, "categoryId": uuidPointer(row.CategoryID), "bucketId": uuidPointer(row.BucketID), "transactionKind": textPointer(row.TransactionKind), "autoApply": row.AutoApply, "confidence": "1.0"})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func matchesRule(raw []byte, description string, amount int64) bool {
	var conditions ruleConditions
	if json.Unmarshal(raw, &conditions) != nil {
		return false
	}
	if conditions.DescriptionContains != "" && !strings.Contains(strings.ToUpper(description), strings.ToUpper(conditions.DescriptionContains)) {
		return false
	}
	if conditions.Direction == "credit" && amount <= 0 {
		return false
	}
	if conditions.Direction == "debit" && amount >= 0 {
		return false
	}
	absolute := amount
	if absolute < 0 {
		if absolute == math.MinInt64 {
			return false
		}
		absolute = -absolute
	}
	if conditions.MinimumAmount != nil && absolute < *conditions.MinimumAmount {
		return false
	}
	if conditions.MaximumAmount != nil && absolute > *conditions.MaximumAmount {
		return false
	}
	return true
}

func validateRuleConditions(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var conditions ruleConditions
	if err := decoder.Decode(&conditions); err != nil {
		return errors.New("conditions must be an object containing supported fields")
	}
	if conditions.DescriptionContains == "" && conditions.Direction == "" && conditions.MinimumAmount == nil && conditions.MaximumAmount == nil {
		return errors.New("at least one categorization condition is required")
	}
	if conditions.Direction != "" && !oneOf(conditions.Direction, "credit", "debit") {
		return errors.New("direction must be credit or debit")
	}
	if conditions.MinimumAmount != nil && *conditions.MinimumAmount < 0 || conditions.MaximumAmount != nil && *conditions.MaximumAmount < 0 {
		return errors.New("amount conditions must not be negative")
	}
	if conditions.MinimumAmount != nil && conditions.MaximumAmount != nil && *conditions.MinimumAmount > *conditions.MaximumAmount {
		return errors.New("minimumAmount must not exceed maximumAmount")
	}
	return nil
}

func (api operationsAPI) createReconciliation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		FinancialAccountID string `json:"financialAccountId"`
		StatementDate      string `json:"statementDate"`
		StatementBalance   string `json:"statementBalance"`
		Complete           bool   `json:"complete"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, 400, "Invalid request", err.Error())
		return
	}
	date, err := time.Parse("2006-01-02", input.StatementDate)
	if err != nil {
		writeProblem(w, 422, "Validation failed", "statementDate must use YYYY-MM-DD")
		return
	}
	balance, err := strconv.ParseInt(input.StatementBalance, 10, 64)
	if err != nil {
		writeProblem(w, 422, "Validation failed", "statementBalance must be an integer string")
		return
	}
	result, err := api.reconciliation.Create(r.Context(), reconciliation.CreateCommand{
		FinancialAccountID: input.FinancialAccountID,
		StatementDate:      date,
		StatementBalance:   balance,
		Complete:           input.Complete,
	})
	if err != nil {
		writeReconciliationError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (api operationsAPI) completeReconciliation(w http.ResponseWriter, r *http.Request) {
	result, err := api.reconciliation.Complete(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeReconciliationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (api operationsAPI) discardDraftReconciliation(w http.ResponseWriter, r *http.Request) {
	err := api.reconciliation.Discard(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeReconciliationError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api operationsAPI) reopenReconciliation(w http.ResponseWriter, r *http.Request) {
	result, err := api.reconciliation.Reopen(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeReconciliationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func writeReconciliationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, reconciliation.ErrAccountNotFound):
		writeProblem(w, http.StatusNotFound, "Financial account not found", "")
	case errors.Is(err, reconciliation.ErrNotFound):
		writeProblem(w, http.StatusNotFound, "Reconciliation not found", "")
	case errors.Is(err, reconciliation.ErrDoesNotBalance):
		writeProblem(w, http.StatusConflict, "Reconciliation does not balance", err.Error())
	case errors.Is(err, reconciliation.ErrOpenExists):
		writeProblem(w, http.StatusConflict, "Open reconciliation already exists", err.Error())
	case errors.Is(err, reconciliation.ErrOutOfOrder):
		writeProblem(w, http.StatusConflict, "Reconciliation is out of order", err.Error())
	case errors.Is(err, reconciliation.ErrInvalidState):
		writeProblem(w, http.StatusConflict, "Invalid reconciliation state", err.Error())
	case errors.Is(err, reconciliation.ErrAmountOverflow):
		writeProblem(w, http.StatusUnprocessableEntity, "Reconciliation amount overflow", err.Error())
	default:
		writeDatabaseError(w, err)
	}
}

func (api operationsAPI) listReconciliations(w http.ResponseWriter, r *http.Request) {
	items, err := api.reconciliation.List(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (api operationsAPI) exportTransactions(w http.ResponseWriter, r *http.Request) {
	rows, err := api.queries.ListTransactionExportEntries(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}

	var output bytes.Buffer
	writer := csv.NewWriter(&output)
	if err := writer.Write([]string{"transaction_id", "date", "description", "kind", "status", "origin", "entry_type", "target", "target_kind", "category", "amount", "memo"}); err != nil {
		writeProblem(w, 500, "Export failed", "could not create CSV export")
		return
	}
	for _, row := range rows {
		record := []string{
			uuidString(row.TransactionID),
			row.OccurredOn.Time.Format(time.DateOnly),
			row.Description,
			row.Kind,
			row.Status,
			row.Origin,
			row.EntryType,
			row.TargetName,
			row.TargetKind,
			"",
			formatInt(row.Amount),
		}
		if row.CategoryName.Valid {
			record[9] = row.CategoryName.String
		}
		if row.Memo.Valid {
			record = append(record, row.Memo.String)
		} else {
			record = append(record, "")
		}
		if err := writer.Write(record); err != nil {
			writeProblem(w, 500, "Export failed", "could not create CSV export")
			return
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		writeProblem(w, 500, "Export failed", "could not create CSV export")
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="money-matrix-transactions.csv"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(output.Bytes())
}

func parseNullableUUID(value *string) (pgtype.UUID, error) {
	if value == nil {
		return pgtype.UUID{}, nil
	}
	return parseUUID(*value)
}
