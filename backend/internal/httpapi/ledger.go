package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kanishkdudeja/money-matrix/backend/internal/ledger"
)

type ledgerAPI struct{ service *ledger.Service }

type postingRequest struct {
	AccountID string  `json:"accountId"`
	Amount    string  `json:"amount"`
	Memo      *string `json:"memo"`
}

type bucketEntryRequest struct {
	BucketID   string  `json:"bucketId"`
	CategoryID *string `json:"categoryId"`
	Amount     string  `json:"amount"`
	Memo       *string `json:"memo"`
}
type createTransactionRequest struct {
	OccurredOn    string               `json:"occurredOn"`
	Description   string               `json:"description"`
	Kind          string               `json:"kind"`
	Postings      []postingRequest     `json:"postings"`
	BucketEntries []bucketEntryRequest `json:"bucketEntries"`
}

func (api ledgerAPI) create(w http.ResponseWriter, r *http.Request) {
	var input createTransactionRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, 400, "Invalid request", err.Error())
		return
	}
	command, err := toCommand(input)
	if err != nil {
		writeProblem(w, 422, "Validation failed", err.Error())
		return
	}
	result, err := api.service.Create(r.Context(), command)
	if err != nil {
		api.writeError(w, err)
		return
	}
	writeJSON(w, 201, result)
}

func (api ledgerAPI) get(w http.ResponseWriter, r *http.Request) {
	if _, err := parseUUID(chi.URLParam(r, "id")); err != nil {
		writeProblem(w, 400, "Invalid transaction ID", err.Error())
		return
	}
	result, err := api.service.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		api.writeError(w, err)
		return
	}
	writeJSON(w, 200, result)
}

func (api ledgerAPI) list(w http.ResponseWriter, r *http.Request) {
	limit, offset, err := pagination(r, 50, 200)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", err.Error())
		return
	}
	items, err := api.service.List(r.Context(), limit, offset)
	if err != nil {
		api.writeError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "limit": limit, "offset": offset})
}

func (api ledgerAPI) reverse(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Description string `json:"description"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, 400, "Invalid request", err.Error())
		return
	}
	input.Description = strings.TrimSpace(input.Description)
	if input.Description == "" {
		input.Description = "Reversal"
	}
	result, err := api.service.Reverse(r.Context(), chi.URLParam(r, "id"), input.Description)
	if err != nil {
		api.writeError(w, err)
		return
	}
	writeJSON(w, 201, result)
}

func toCommand(input createTransactionRequest) (ledger.CreateCommand, error) {
	date, err := time.Parse("2006-01-02", input.OccurredOn)
	if err != nil {
		return ledger.CreateCommand{}, errors.New("occurredOn must use YYYY-MM-DD")
	}
	command := ledger.CreateCommand{OccurredOn: date, Description: strings.TrimSpace(input.Description), Kind: input.Kind, Origin: "manual"}
	if command.Postings, err = convertPostings(input.Postings); err != nil {
		return command, err
	}
	if command.BucketEntries, err = convertBucketEntries(input.BucketEntries); err != nil {
		return command, err
	}
	return command, nil
}

func convertPostings(source []postingRequest) ([]ledger.PostingInput, error) {
	result := make([]ledger.PostingInput, 0, len(source))
	for _, entry := range source {
		if _, err := parseUUID(entry.AccountID); err != nil {
			return nil, errors.New("posting accountId must be a UUID")
		}
		amount, err := parseAmount(entry.Amount)
		if err != nil {
			return nil, err
		}
		result = append(result, ledger.PostingInput{AccountID: entry.AccountID, Amount: amount, Memo: entry.Memo})
	}
	return result, nil
}

func convertBucketEntries(source []bucketEntryRequest) ([]ledger.BucketEntryInput, error) {
	result := make([]ledger.BucketEntryInput, 0, len(source))
	for _, entry := range source {
		if _, err := parseUUID(entry.BucketID); err != nil {
			return nil, errors.New("bucket entry bucketId must be a UUID")
		}
		if entry.CategoryID != nil {
			if _, err := parseUUID(*entry.CategoryID); err != nil {
				return nil, errors.New("bucket entry categoryId must be a UUID")
			}
		}
		amount, err := parseAmount(entry.Amount)
		if err != nil {
			return nil, err
		}
		result = append(result, ledger.BucketEntryInput{BucketID: entry.BucketID, CategoryID: entry.CategoryID, Amount: amount, Memo: entry.Memo})
	}
	return result, nil
}

func (api ledgerAPI) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ledger.ErrNotFound):
		writeProblem(w, 404, "Transaction not found", "")
	case errors.Is(err, ledger.ErrAlreadyReversed):
		writeProblem(w, 409, "Transaction already reversed", "")
	case errors.Is(err, ledger.ErrInvalid):
		writeProblem(w, 422, "Invalid transaction", err.Error())
	default:
		slog.Error("ledger operation failed", "error", err)
		writeProblem(w, 500, "Database error", "an unexpected database error occurred")
	}
}
