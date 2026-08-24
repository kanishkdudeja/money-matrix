package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
	"github.com/kanishkdudeja/money-matrix/backend/internal/id"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type catalogAPI struct{ queries *dbgen.Queries }

type accountResponse struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	BalanceClass string  `json:"balanceClass"`
	Currency     string  `json:"currency"`
	Note         *string `json:"note,omitempty"`
	Balance      string  `json:"balance"`
	Archived     bool    `json:"archived"`
}

type createAccountRequest struct {
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	BalanceClass string  `json:"balanceClass"`
	Currency     string  `json:"currency"`
	Note         *string `json:"note"`
}

type namedResourceResponse struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Kind     *string `json:"kind,omitempty"`
	ParentID *string `json:"parentId,omitempty"`
	Note     *string `json:"note,omitempty"`
	Archived bool    `json:"archived"`
	System   bool    `json:"system,omitempty"`
	Balance  string  `json:"balance,omitempty"`
}

func (api catalogAPI) listAccounts(w http.ResponseWriter, r *http.Request) {
	rows, err := api.queries.ListAccountSummaries(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	items := make([]accountResponse, 0, len(rows))
	for _, row := range rows {
		items = append(items, accountResponse{
			ID:           uuidString(row.ID),
			Name:         row.Name,
			Kind:         row.Kind,
			BalanceClass: row.BalanceClass,
			Currency:     row.Currency,
			Note:         textPointer(row.Note),
			Balance:      formatInt(row.Balance),
			Archived:     row.Archived,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (api catalogAPI) createAccount(w http.ResponseWriter, r *http.Request) {
	var input createAccountRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", err.Error())
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	if input.Name == "" || !oneOf(input.Kind, "bank", "cash", "credit_card", "loan", "investment", "other") || !oneOf(input.BalanceClass, "asset", "liability") || input.Currency != "INR" {
		writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "name, kind, balanceClass and INR currency are required")
		return
	}
	row, err := api.queries.CreateFinancialAccount(r.Context(), dbgen.CreateFinancialAccountParams{
		ID:           mustParseUUID(id.New()),
		Name:         input.Name,
		Kind:         input.Kind,
		BalanceClass: input.BalanceClass,
		Currency:     input.Currency,
		Note:         optionalText(input.Note),
	})
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, accountResponse{
		ID:           uuidString(row.ID),
		Name:         row.Name,
		Kind:         row.Kind,
		BalanceClass: row.BalanceClass,
		Currency:     row.Currency,
		Note:         textPointer(row.Note),
		Balance:      "0",
	})
}

func (api catalogAPI) updateAccount(w http.ResponseWriter, r *http.Request) {
	accountID, err := parseUUID(chi.URLParam(r, "id"))
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid account ID", err.Error())
		return
	}
	var input struct {
		Name *string        `json:"name"`
		Note nullableString `json:"note"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", err.Error())
		return
	}
	var name pgtype.Text
	if input.Name != nil {
		value := strings.TrimSpace(*input.Name)
		if value == "" {
			writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "name cannot be empty")
			return
		}
		name = pgtype.Text{String: value, Valid: true}
	}
	rows, err := api.queries.UpdateFinancialAccount(r.Context(), dbgen.UpdateFinancialAccountParams{
		ID:        accountID,
		Name:      name,
		NoteIsSet: input.Note.Set,
		Note:      optionalText(input.Note.Value),
	})
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	writeRowsAffected(w, rows, "Account not found")
}

func (api catalogAPI) archiveAccount(w http.ResponseWriter, r *http.Request) {
	api.changeArchiveState(w, r, api.queries.ArchiveFinancialAccount, "Account not found")
}

func (api catalogAPI) unarchiveAccount(w http.ResponseWriter, r *http.Request) {
	api.changeArchiveState(w, r, api.queries.UnarchiveFinancialAccount, "Account not found")
}

func (api catalogAPI) listCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := api.queries.ListCategorySummaries(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	items := make([]namedResourceResponse, 0, len(rows))
	for _, row := range rows {
		kind := row.Kind
		items = append(items, namedResourceResponse{ID: uuidString(row.ID), Name: row.Name, Kind: &kind, ParentID: uuidPointer(row.ParentID), Archived: row.Archived})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (api catalogAPI) createCategory(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name     string  `json:"name"`
		Kind     string  `json:"kind"`
		ParentID *string `json:"parentId"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", err.Error())
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || !oneOf(input.Kind, "income", "expense") {
		writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "name and kind are required")
		return
	}
	var parentID pgtype.UUID
	if input.ParentID != nil {
		var err error
		parentID, err = parseUUID(*input.ParentID)
		if err != nil {
			writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "invalid parentId")
			return
		}
	}
	row, err := api.queries.CreateCategory(r.Context(), dbgen.CreateCategoryParams{ID: mustParseUUID(id.New()), Name: input.Name, Kind: input.Kind, ParentID: parentID})
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	kind := row.Kind
	writeJSON(w, http.StatusCreated, namedResourceResponse{ID: uuidString(row.ID), Name: row.Name, Kind: &kind, ParentID: uuidPointer(row.ParentID)})
}

func (api catalogAPI) archiveCategory(w http.ResponseWriter, r *http.Request) {
	api.changeArchiveState(w, r, api.queries.ArchiveCategory, "Category not found")
}

func (api catalogAPI) unarchiveCategory(w http.ResponseWriter, r *http.Request) {
	api.changeArchiveState(w, r, api.queries.UnarchiveCategory, "Category not found")
}

func (api catalogAPI) listBuckets(w http.ResponseWriter, r *http.Request) {
	rows, err := api.queries.ListBucketSummaries(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	items := make([]namedResourceResponse, 0, len(rows))
	for _, row := range rows {
		items = append(items, namedResourceResponse{ID: uuidString(row.ID), Name: row.Name, Note: textPointer(row.Note), Archived: row.Archived, System: row.System, Balance: formatInt(row.Balance)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (api catalogAPI) createBucket(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string  `json:"name"`
		Note *string `json:"note"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", err.Error())
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", "name is required")
		return
	}
	row, err := api.queries.CreateBucket(r.Context(), dbgen.CreateBucketParams{ID: mustParseUUID(id.New()), Name: input.Name, Note: optionalText(input.Note)})
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, namedResourceResponse{ID: uuidString(row.ID), Name: row.Name, Note: textPointer(row.Note), Balance: "0"})
}

func (api catalogAPI) archiveBucket(w http.ResponseWriter, r *http.Request) {
	api.changeArchiveState(w, r, api.queries.ArchiveBucket, "Bucket not found")
}

func (api catalogAPI) unarchiveBucket(w http.ResponseWriter, r *http.Request) {
	api.changeArchiveState(w, r, api.queries.UnarchiveBucket, "Bucket not found")
}

func (api catalogAPI) changeArchiveState(w http.ResponseWriter, r *http.Request, change func(context.Context, pgtype.UUID) (int64, error), notFoundTitle string) {
	resourceID, err := parseUUID(chi.URLParam(r, "id"))
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid ID", err.Error())
		return
	}
	rows, err := change(r.Context(), resourceID)
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	writeRowsAffected(w, rows, notFoundTitle)
}

func writeRowsAffected(w http.ResponseWriter, rows int64, notFoundTitle string) {
	if rows == 0 {
		writeProblem(w, http.StatusNotFound, notFoundTitle, "")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func formatInt(value int64) string { return strconv.FormatInt(value, 10) }

func writeDatabaseError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeProblem(w, http.StatusNotFound, "Resource not found", "")
		return
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505":
			writeProblem(w, http.StatusConflict, "Resource already exists", "")
			return
		case "23503", "23514":
			writeProblem(w, http.StatusUnprocessableEntity, "Constraint violation", postgresError.Message)
			return
		}
	}
	slog.Error("database operation failed", "error", err)
	writeProblem(w, http.StatusInternalServerError, "Database error", "an unexpected database error occurred")
}
