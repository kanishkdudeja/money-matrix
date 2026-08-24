package httpapi

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLedgerWorkflowAgainstPostgres(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	defer pool.Close()
	resetTestDatabase(t, pool)

	router := NewApplicationRouter(pool, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	invalidIDRequest := httptest.NewRequest(http.MethodGet, "/api/transactions/not-a-uuid", nil)
	invalidIDResponse := httptest.NewRecorder()
	router.ServeHTTP(invalidIDResponse, invalidIDRequest)
	if invalidIDResponse.Code != http.StatusBadRequest {
		t.Fatalf("generated OpenAPI parameter validation status = %d, want 400", invalidIDResponse.Code)
	}
	bank := postJSON(t, router, "/api/accounts", map[string]any{"name": "Test Bank", "kind": "bank", "balanceClass": "asset", "currency": "INR"}, http.StatusCreated)
	card := postJSON(t, router, "/api/accounts", map[string]any{"name": "Test Card", "kind": "credit_card", "balanceClass": "liability", "currency": "INR"}, http.StatusCreated)

	postJSON(t, router, "/api/transactions", map[string]any{
		"occurredOn": "2026-08-01", "description": "Salary", "kind": "income",
		"postings": []map[string]any{{"accountId": bank["id"], "amount": "10000", "memo": "August payroll"}},
	}, http.StatusCreated)

	charge := postJSON(t, router, "/api/transactions", map[string]any{
		"occurredOn": "2026-08-02", "description": "Card purchase", "kind": "expense",
		"postings": []map[string]any{{"accountId": card["id"], "amount": "2000"}},
	}, http.StatusCreated)

	dashboard := getJSON(t, router, "/api/dashboard", http.StatusOK)
	if dashboard["netCovered"] != "8000" || dashboard["bucketTotal"] != "8000" || dashboard["balanced"] != true {
		t.Fatalf("unexpected dashboard after charge: %#v", dashboard)
	}

	postJSON(t, router, "/api/transactions/"+charge["id"].(string)+"/reverse", map[string]any{"description": "Correct card purchase"}, http.StatusCreated)
	dashboard = getJSON(t, router, "/api/dashboard", http.StatusOK)
	if dashboard["netCovered"] != "10000" || dashboard["bucketTotal"] != "10000" || dashboard["balanced"] != true {
		t.Fatalf("unexpected dashboard after reversal: %#v", dashboard)
	}
	accounts := getJSON(t, router, "/api/accounts", http.StatusOK)
	if balance := itemByID(t, accounts, card["id"].(string))["balance"]; balance != "0" {
		t.Fatalf("card balance after reversal = %v, want 0", balance)
	}
	buckets := getJSON(t, router, "/api/buckets", http.StatusOK)
	unallocated := itemByID(t, buckets, "00000000-0000-0000-0000-000000000001")
	if balance := unallocated["balance"]; balance != "10000" {
		t.Fatalf("unallocated balance after reversal = %v, want 10000", balance)
	}
	if unallocated["system"] != true {
		t.Fatalf("fixed Unallocated UUID was not recognized as a system bucket: %#v", unallocated)
	}
	requestJSON(t, router, http.MethodPost, "/api/buckets/00000000-0000-0000-0000-000000000001/archive", nil, http.StatusNotFound)

	vacation := postJSON(t, router, "/api/buckets", map[string]any{"name": "Vacation"}, http.StatusCreated)
	requestJSON(t, router, http.MethodPost, "/api/buckets/"+vacation["id"].(string)+"/archive", nil, http.StatusNoContent)
	requestJSON(t, router, http.MethodPost, "/api/buckets/"+vacation["id"].(string)+"/unarchive", nil, http.StatusNoContent)
	postJSON(t, router, "/api/transactions", map[string]any{
		"occurredOn": "2026-08-03", "description": "Reserve vacation money", "kind": "bucket_transfer",
		"bucketEntries": []map[string]any{
			{"bucketId": "00000000-0000-0000-0000-000000000001", "amount": "-3000"},
			{"bucketId": vacation["id"], "amount": "3000"},
		},
	}, http.StatusCreated)
	dashboard = getJSON(t, router, "/api/dashboard", http.StatusOK)
	if dashboard["difference"] != "0" {
		t.Fatalf("bucket transfer broke reconciliation: %#v", dashboard)
	}

	postJSON(t, router, "/api/reconciliations", map[string]any{
		"financialAccountId": bank["id"], "statementDate": "2026-08-31", "statementBalance": "10000", "complete": true,
	}, http.StatusCreated)

	var upload bytes.Buffer
	multipartWriter := multipart.NewWriter(&upload)
	_ = multipartWriter.WriteField("accountId", bank["id"].(string))
	_ = multipartWriter.WriteField("mapping", `{"dateColumn":"Date","descriptionColumn":"Description","debitColumn":"Debit","creditColumn":"Credit","balanceColumn":"Balance","dateFormat":"02/01/2006"}`)
	filePart, _ := multipartWriter.CreateFormFile("file", "statement.csv")
	_, _ = filePart.Write([]byte("Date,Description,Debit,Credit,Balance\n01/09/2026,Coffee,100.00,,9900.00\n"))
	_ = multipartWriter.Close()
	uploadRequest := httptest.NewRequest(http.MethodPost, "/api/imports/csv", &upload)
	uploadRequest.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	uploadResult := performJSON(t, router, uploadRequest, http.StatusCreated)
	if uploadResult["imported"] != float64(1) {
		t.Fatalf("unexpected import result: %#v", uploadResult)
	}

	cardImport := uploadCSVForTest(t, router, card["id"].(string), "card-statement.csv", "Date,Description,Debit,Credit,Balance\n02/09/2026,Imported card purchase,25.00,,25.00\n")
	cardBatch := getJSON(t, router, "/api/imports/"+cardImport["id"].(string), http.StatusOK)
	cardRow := cardBatch["rows"].([]any)[0].(map[string]any)
	if cardRow["amount"] != "-2500" {
		t.Fatalf("card imported review amount = %v, want -2500", cardRow["amount"])
	}
	cardTransaction := getJSON(t, router, "/api/transactions/"+cardRow["transactionId"].(string), http.StatusOK)
	cardPosting := cardTransaction["postings"].([]any)[0].(map[string]any)
	if cardPosting["amount"] != "2500" {
		t.Fatalf("card imported ledger posting = %v, want 2500", cardPosting["amount"])
	}
	accounts = getJSON(t, router, "/api/accounts", http.StatusOK)
	if balance := itemByID(t, accounts, card["id"].(string))["balance"]; balance != "2500" {
		t.Fatalf("card balance after imported purchase = %v, want 2500", balance)
	}
	dashboard = getJSON(t, router, "/api/dashboard", http.StatusOK)
	if dashboard["netCovered"] != "-2500" || dashboard["bucketTotal"] != "-2500" || dashboard["balanced"] != true {
		t.Fatalf("card import broke financial coverage: %#v", dashboard)
	}

	food := postJSON(t, router, "/api/categories", map[string]any{"name": "Food", "kind": "expense"}, http.StatusCreated)
	requestJSON(t, router, http.MethodPost, "/api/categories/"+food["id"].(string)+"/archive", nil, http.StatusNoContent)
	requestJSON(t, router, http.MethodPost, "/api/categories/"+food["id"].(string)+"/unarchive", nil, http.StatusNoContent)
	fees := postJSON(t, router, "/api/categories", map[string]any{"name": "Fees", "kind": "expense"}, http.StatusCreated)
	emergency := postJSON(t, router, "/api/buckets", map[string]any{"name": "Emergency"}, http.StatusCreated)
	split := postJSON(t, router, "/api/transactions", map[string]any{
		"occurredOn": "2026-09-02", "description": "Split transaction", "kind": "expense",
		"postings": []map[string]any{
			{"accountId": bank["id"], "amount": "-300"},
			{"accountId": card["id"], "amount": "100"},
		},
		"bucketEntries": []map[string]any{
			{"bucketId": vacation["id"], "categoryId": food["id"], "amount": "-200"},
			{"bucketId": emergency["id"], "categoryId": fees["id"], "amount": "-200"},
		},
	}, http.StatusCreated)
	splitEntries, ok := split["bucketEntries"].([]any)
	if !ok || len(splitEntries) != 2 {
		t.Fatalf("split transaction does not contain two bucket entries: %#v", split)
	}
	firstEntry, firstOK := splitEntries[0].(map[string]any)
	secondEntry, secondOK := splitEntries[1].(map[string]any)
	if !firstOK || !secondOK ||
		firstEntry["bucketId"] != vacation["id"] || firstEntry["categoryId"] != food["id"] ||
		secondEntry["bucketId"] != emergency["id"] || secondEntry["categoryId"] != fees["id"] {
		t.Fatalf("category-to-bucket pairing was not preserved: %#v", splitEntries)
	}

	exportRequest := httptest.NewRequest(http.MethodGet, "/api/export/transactions.csv", nil)
	exportResponse := httptest.NewRecorder()
	router.ServeHTTP(exportResponse, exportRequest)
	if exportResponse.Code != http.StatusOK || !bytes.Contains(exportResponse.Body.Bytes(), []byte("Salary")) {
		t.Fatalf("unexpected CSV export: status=%d body=%s", exportResponse.Code, exportResponse.Body.String())
	}
	records, err := csv.NewReader(bytes.NewReader(exportResponse.Body.Bytes())).ReadAll()
	if err != nil {
		t.Fatalf("parse CSV export: %v", err)
	}
	var splitRows int
	for _, record := range records[1:] {
		if record[0] == split["id"].(string) {
			splitRows++
		}
	}
	if splitRows != 4 {
		t.Fatalf("split transaction exported as %d rows, want one row per 4 entries", splitRows)
	}
}

func itemByID(t *testing.T, response map[string]any, id string) map[string]any {
	t.Helper()
	items, ok := response["items"].([]any)
	if !ok {
		t.Fatalf("response does not contain an items array: %#v", response)
	}
	for _, value := range items {
		item, ok := value.(map[string]any)
		if ok && item["id"] == id {
			return item
		}
	}
	t.Fatalf("item %s not found in response: %#v", id, response)
	return nil
}

func resetTestDatabase(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `TRUNCATE financial_accounts, transactions, categories, buckets, parser_profiles, import_batches, categorization_rules, reconciliations, plans CASCADE`)
	if err != nil {
		t.Fatalf("truncate test database: %v", err)
	}
	_, err = pool.Exec(context.Background(), `INSERT INTO buckets(id,name,note) VALUES('00000000-0000-0000-0000-000000000001','Unallocated','System bucket')`)
	if err != nil {
		t.Fatalf("seed test database: %v", err)
	}
}

func postJSON(t *testing.T, handler http.Handler, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	encoded, _ := json.Marshal(body)
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	return performJSON(t, handler, request, wantStatus)
}

func getJSON(t *testing.T, handler http.Handler, path string, wantStatus int) map[string]any {
	t.Helper()
	return performJSON(t, handler, httptest.NewRequest(http.MethodGet, path, nil), wantStatus)
}

func performJSON(t *testing.T, handler http.Handler, request *http.Request, wantStatus int) map[string]any {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != wantStatus {
		t.Fatalf("%s %s status=%d want=%d body=%s", request.Method, request.URL.Path, response.Code, wantStatus, response.Body.String())
	}
	var result map[string]any
	if response.Body.Len() > 0 {
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatalf("decode response: %v", err)
		}
	}
	return result
}
