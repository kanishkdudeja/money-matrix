package httpapi

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
	"github.com/kanishkdudeja/money-matrix/backend/internal/id"
	"github.com/kanishkdudeja/money-matrix/backend/internal/importing"
	"github.com/kanishkdudeja/money-matrix/backend/internal/ledger"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type importAPI struct {
	queries  *dbgen.Queries
	workflow *importing.Service
}

type csvMapping struct {
	DateColumn        string `json:"dateColumn"`
	DescriptionColumn string `json:"descriptionColumn"`
	ReferenceColumn   string `json:"referenceColumn"`
	AmountColumn      string `json:"amountColumn"`
	DebitColumn       string `json:"debitColumn"`
	CreditColumn      string `json:"creditColumn"`
	BalanceColumn     string `json:"balanceColumn"`
	DateFormat        string `json:"dateFormat"`
}

func (api importAPI) uploadCSV(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeProblem(w, 400, "Invalid upload", err.Error())
		return
	}
	defer r.MultipartForm.RemoveAll()
	accountID := r.FormValue("accountId")
	accountUUID, err := parseUUID(accountID)
	if err != nil {
		writeProblem(w, 422, "Validation failed", "accountId must be a UUID")
		return
	}
	profileID := r.FormValue("profileId")
	mappingText := r.FormValue("mapping")
	if mappingText == "" && profileID != "" {
		profileUUID, parseErr := parseUUID(profileID)
		if parseErr != nil {
			writeProblem(w, 422, "Validation failed", "profileId must be a UUID")
			return
		}
		raw, queryErr := api.queries.GetCSVParserProfileMapping(r.Context(), profileUUID)
		if queryErr != nil {
			writeProblem(w, 422, "Validation failed", "CSV parser profile was not found")
			return
		}
		mappingText = string(raw)
	}
	var mapping csvMapping
	if err := json.Unmarshal([]byte(mappingText), &mapping); err != nil {
		writeProblem(w, 422, "Validation failed", "mapping or profileId must provide a valid CSV mapping")
		return
	}
	if mapping.DateFormat == "" {
		mapping.DateFormat = "02/01/2006"
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeProblem(w, 422, "Validation failed", "CSV file is required")
		return
	}
	defer file.Close()
	contents, err := io.ReadAll(file)
	if err != nil {
		writeProblem(w, 400, "Invalid upload", err.Error())
		return
	}
	fileSum := sha256.Sum256(contents)
	fileHash := hex.EncodeToString(fileSum[:])
	reader := csv.NewReader(strings.NewReader(string(contents)))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil || len(records) < 2 {
		writeProblem(w, 422, "Invalid CSV", "a header and at least one data row are required")
		return
	}
	columns := make(map[string]int)
	for index, name := range records[0] {
		columns[strings.TrimSpace(name)] = index
	}
	required := []string{mapping.DateColumn, mapping.DescriptionColumn}
	if mapping.AmountColumn == "" {
		required = append(required, mapping.DebitColumn, mapping.CreditColumn)
	} else {
		required = append(required, mapping.AmountColumn)
	}
	for _, name := range required {
		if name == "" {
			writeProblem(w, 422, "Invalid mapping", "required columns are missing")
			return
		}
		if _, ok := columns[name]; !ok {
			writeProblem(w, 422, "Invalid mapping", "column not found: "+name)
			return
		}
	}
	batchID := id.New()
	var profileIDPointer *string
	if profileID != "" {
		if _, parseErr := parseUUID(profileID); parseErr != nil {
			writeProblem(w, 422, "Validation failed", "profileId must be a UUID")
			return
		}
		profileIDPointer = &profileID
	}
	preparedRows := make([]importing.Row, 0, len(records)-1)
	canonicalAccountID := uuidString(accountUUID)
	for index, row := range records[1:] {
		raw := make(map[string]string)
		for name, position := range columns {
			if position < len(row) {
				raw[name] = row[position]
			}
		}
		rawJSON := mustJSON(raw)
		date, amount, balance, parseErr := parseCSVRow(row, columns, mapping)
		description := cell(row, columns[mapping.DescriptionColumn])
		reference := ""
		if mapping.ReferenceColumn != "" {
			reference = cell(row, columns[mapping.ReferenceColumn])
		}
		prepared := importing.Row{
			ID:          id.New(),
			SourceRow:   int32(index + 2),
			RawData:     rawJSON,
			Date:        date,
			Description: description,
			Reference:   reference,
			Amount:      amount,
			Balance:     balance,
		}
		if parseErr != nil {
			prepared.ParseError = parseErr.Error()
			preparedRows = append(preparedRows, prepared)
			continue
		}
		prepared.Fingerprint = importFingerprint(canonicalAccountID, date, description, reference, amount)
		preparedRows = append(preparedRows, prepared)
	}
	result, err := api.workflow.CommitCSV(r.Context(), importing.UploadCommand{
		BatchID: batchID, AccountID: canonicalAccountID, ProfileID: profileIDPointer,
		FileName: header.Filename, FileHash: fileHash, Rows: preparedRows,
	})
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (api importAPI) listBatches(w http.ResponseWriter, r *http.Request) {
	limit, offset, err := pagination(r, 50, 200)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", err.Error())
		return
	}
	var status pgtype.Text
	if value := r.URL.Query().Get("status"); value != "" {
		if !oneOf(value, "uploaded", "processing", "ready", "failed", "completed") {
			writeProblem(w, http.StatusBadRequest, "Invalid status", "unsupported import status")
			return
		}
		status = pgtype.Text{String: value, Valid: true}
	}
	rows, err := api.queries.ListImportBatchSummaries(r.Context(), dbgen.ListImportBatchSummariesParams{
		Status:     status,
		PageLimit:  int32(limit),
		PageOffset: int32(offset),
	})
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, map[string]any{
			"id":         uuidString(row.ID),
			"accountId":  uuidString(row.FinancialAccountID),
			"fileName":   row.FileName,
			"status":     row.Status,
			"createdAt":  row.CreatedAt.Time,
			"imported":   row.Imported,
			"duplicates": row.Duplicates,
			"invalid":    row.Invalid,
			"pending":    row.Pending,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "limit": limit, "offset": offset})
}

func (api importAPI) listProfiles(w http.ResponseWriter, r *http.Request) {
	rows, err := api.queries.ListParserProfiles(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, map[string]any{"id": uuidString(row.ID), "name": row.Name, "format": row.Format, "institution": textPointer(row.Institution), "mapping": json.RawMessage(row.Mapping), "parserVersion": row.ParserVersion})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (api importAPI) createProfile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name          string          `json:"name"`
		Format        string          `json:"format"`
		Institution   *string         `json:"institution"`
		Mapping       json.RawMessage `json:"mapping"`
		ParserVersion string          `json:"parserVersion"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, 400, "Invalid request", err.Error())
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.ParserVersion == "" {
		input.ParserVersion = "1"
	}
	if input.Name == "" || !oneOf(input.Format, "csv", "xlsx", "pdf") || !json.Valid(input.Mapping) {
		writeProblem(w, 422, "Validation failed", "name, supported format, and mapping are required")
		return
	}
	row, err := api.queries.CreateParserProfile(r.Context(), dbgen.CreateParserProfileParams{
		ID:            mustParseUUID(id.New()),
		Name:          input.Name,
		Format:        input.Format,
		Institution:   optionalText(input.Institution),
		Mapping:       input.Mapping,
		ParserVersion: input.ParserVersion,
	})
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": uuidString(row.ID), "name": row.Name, "format": row.Format, "institution": textPointer(row.Institution), "mapping": json.RawMessage(row.Mapping), "parserVersion": row.ParserVersion})
}

func (api importAPI) getBatch(w http.ResponseWriter, r *http.Request) {
	batchID := chi.URLParam(r, "id")
	if _, err := parseUUID(batchID); err != nil {
		writeProblem(w, 400, "Invalid import ID", err.Error())
		return
	}
	var result struct {
		ID        string           `json:"id"`
		AccountID string           `json:"accountId"`
		FileName  string           `json:"fileName"`
		Status    string           `json:"status"`
		CreatedAt time.Time        `json:"createdAt"`
		Rows      []map[string]any `json:"rows"`
	}
	batch, err := api.queries.GetImportBatch(r.Context(), mustParseUUID(batchID))
	if errors.Is(err, pgx.ErrNoRows) {
		writeProblem(w, 404, "Import not found", "")
		return
	}
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	result.ID = uuidString(batch.ID)
	result.AccountID = uuidString(batch.FinancialAccountID)
	result.FileName = batch.FileName
	result.Status = batch.Status
	result.CreatedAt = batch.CreatedAt.Time
	rows, err := api.queries.ListImportedRows(r.Context(), batch.ID)
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	result.Rows = make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		result.Rows = append(result.Rows, map[string]any{
			"id":              uuidString(row.ID),
			"sourceRow":       row.SourceRow,
			"transactionDate": datePointer(row.TransactionDate),
			"description":     textPointer(row.Description),
			"reference":       textPointer(row.Reference),
			"amount":          intPointer(row.Amount),
			"balance":         intPointer(row.Balance),
			"transactionId":   uuidPointer(row.TransactionID),
			"reviewStatus":    row.ReviewStatus,
			"parseErrors":     json.RawMessage(row.ParseErrors),
		})
	}
	writeJSON(w, http.StatusOK, result)
}

func (api importAPI) categorize(w http.ResponseWriter, r *http.Request) {
	rowID := chi.URLParam(r, "id")
	if _, err := parseUUID(rowID); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid imported row ID", "")
		return
	}
	var input struct {
		BucketEntries []bucketEntryRequest `json:"bucketEntries"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeProblem(w, 400, "Invalid request", err.Error())
		return
	}
	bucketEntries, err := convertBucketEntries(input.BucketEntries)
	if err != nil {
		writeProblem(w, 422, "Validation failed", err.Error())
		return
	}
	result, err := api.workflow.Review(r.Context(), rowID, ledger.ClassificationCommand{
		BucketEntries: bucketEntries,
	})
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"id": result.RowID, "transactionId": result.TransactionID, "reviewStatus": "reviewed"})
	case errors.Is(err, importing.ErrImportedRowNotFound):
		writeProblem(w, http.StatusNotFound, "Imported row not found", "")
	case errors.Is(err, ledger.ErrInvalid):
		writeProblem(w, http.StatusUnprocessableEntity, "Validation failed", err.Error())
	case errors.Is(err, ledger.ErrImmutable):
		writeProblem(w, http.StatusConflict, "Transaction is immutable", err.Error())
	default:
		writeDatabaseError(w, err)
	}
}

func (api importAPI) skip(w http.ResponseWriter, r *http.Request) {
	rowID := chi.URLParam(r, "id")
	if _, err := parseUUID(rowID); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid imported row ID", "")
		return
	}
	err := api.workflow.Skip(r.Context(), rowID)
	if errors.Is(err, importing.ErrImportedRowNotFound) {
		writeProblem(w, http.StatusNotFound, "Pending imported row not found", "")
		return
	}
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseCSVRow(row []string, columns map[string]int, m csvMapping) (time.Time, int64, *int64, error) {
	date, err := time.Parse(m.DateFormat, cell(row, columns[m.DateColumn]))
	if err != nil {
		return time.Time{}, 0, nil, fmt.Errorf("invalid date: %w", err)
	}
	var amount int64
	if m.AmountColumn != "" {
		amount, err = parseDecimalMinor(cell(row, columns[m.AmountColumn]))
	} else {
		debit, debitErr := parseDecimalMinorOptional(cell(row, columns[m.DebitColumn]))
		if debitErr != nil {
			return time.Time{}, 0, nil, fmt.Errorf("invalid debit: %w", debitErr)
		}
		credit, creditErr := parseDecimalMinorOptional(cell(row, columns[m.CreditColumn]))
		if creditErr != nil {
			return time.Time{}, 0, nil, fmt.Errorf("invalid credit: %w", creditErr)
		}
		var valid bool
		amount, valid = checkedSubtract(credit, debit)
		if !valid {
			return time.Time{}, 0, nil, errors.New("debit and credit difference is outside the supported range")
		}
	}
	if err != nil || amount == 0 {
		return time.Time{}, 0, nil, errors.New("invalid or zero amount")
	}
	var balance *int64
	if m.BalanceColumn != "" {
		balanceText := cell(row, columns[m.BalanceColumn])
		if balanceText != "" && balanceText != "-" {
			value, parseErr := parseDecimalMinor(balanceText)
			if parseErr != nil {
				return time.Time{}, 0, nil, fmt.Errorf("invalid balance: %w", parseErr)
			}
			balance = &value
		}
	}
	return date, amount, balance, nil
}
func parseDecimalMinor(value string) (int64, error) {
	value = strings.TrimSpace(value)
	replacer := strings.NewReplacer(",", "", "₹", "", " ", "")
	value = replacer.Replace(value)
	negative := false
	if strings.HasPrefix(value, "(") || strings.HasSuffix(value, ")") {
		if !strings.HasPrefix(value, "(") || !strings.HasSuffix(value, ")") {
			return 0, errors.New("invalid parentheses in amount")
		}
		negative = true
		value = strings.TrimSuffix(strings.TrimPrefix(value, "("), ")")
	}
	if strings.HasPrefix(value, "-") || strings.HasPrefix(value, "+") {
		if negative {
			return 0, errors.New("amount cannot combine a sign with parentheses")
		}
		negative = strings.HasPrefix(value, "-")
		value = value[1:]
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 || len(parts) == 0 || parts[0] == "" {
		return 0, errors.New("invalid amount")
	}
	whole, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		return 0, err
	}
	fraction := uint64(0)
	if len(parts) == 2 {
		if len(parts[1]) > 2 {
			return 0, errors.New("more than two decimal places")
		}
		padded := parts[1] + strings.Repeat("0", 2-len(parts[1]))
		fraction, err = strconv.ParseUint(padded, 10, 64)
		if err != nil {
			return 0, err
		}
	}
	limit := uint64(math.MaxInt64)
	if negative {
		limit++
	}
	if whole > limit/100 {
		return 0, errors.New("amount is outside the supported range")
	}
	absolute := whole * 100
	if absolute > limit-fraction {
		return 0, errors.New("amount is outside the supported range")
	}
	absolute += fraction
	if negative {
		if absolute == uint64(math.MaxInt64)+1 {
			return math.MinInt64, nil
		}
		return -int64(absolute), nil
	}
	return int64(absolute), nil
}
func parseDecimalMinorOptional(value string) (int64, error) {
	if strings.TrimSpace(value) == "" || strings.TrimSpace(value) == "-" {
		return 0, nil
	}
	return parseDecimalMinor(value)
}

func checkedSubtract(left, right int64) (int64, bool) {
	if (right > 0 && left < math.MinInt64+right) || (right < 0 && left > math.MaxInt64+right) {
		return 0, false
	}
	return left - right, true
}
func cell(row []string, index int) string {
	if index < 0 || index >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[index])
}
func importFingerprint(accountID string, date time.Time, description, reference string, amount int64) string {
	value := fmt.Sprintf("%s|%s|%s|%s|%d", accountID, date.Format("2006-01-02"), strings.ToUpper(strings.Join(strings.Fields(description), " ")), strings.ToUpper(strings.TrimSpace(reference)), amount)
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func mustJSON(value any) []byte { result, _ := json.Marshal(value); return result }
