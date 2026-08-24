package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"sync"
	"testing"

	"github.com/kanishkdudeja/money-matrix/backend/internal/id"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestIntegrityAndLifecycleWorkflowsAgainstPostgres(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	resetTestDatabase(t, pool)
	if _, err := pool.Exec(context.Background(), `DELETE FROM buckets WHERE id = '00000000-0000-0000-0000-000000000001'`); err == nil {
		t.Fatal("database allowed the fixed Unallocated bucket to be deleted")
	}
	router := NewApplicationRouter(pool, slog.New(slog.NewTextHandler(io.Discard, nil)), "")

	requestJSON(t, router, http.MethodPost, "/api/accounts", map[string]any{
		"name": "Dollar account", "kind": "bank", "balanceClass": "asset", "currency": "USD",
	}, http.StatusBadRequest)
	bank := postJSON(t, router, "/api/accounts", map[string]any{
		"name": "Integrity Bank", "kind": "bank", "balanceClass": "asset", "currency": "INR", "note": "clear me",
	}, http.StatusCreated)
	requestJSON(t, router, http.MethodPatch, "/api/accounts/"+bank["id"].(string), map[string]any{"note": nil}, http.StatusNoContent)
	accountList := getJSON(t, router, "/api/accounts", http.StatusOK)
	if note, exists := itemByID(t, accountList, bank["id"].(string))["note"]; exists || note != nil {
		t.Fatalf("explicit null did not clear account note: %#v", note)
	}

	incomeParent := postJSON(t, router, "/api/categories", map[string]any{"name": "Income parent", "kind": "income"}, http.StatusCreated)
	requestJSON(t, router, http.MethodPost, "/api/categories", map[string]any{
		"name": "Wrong child", "kind": "expense", "parentId": incomeParent["id"],
	}, http.StatusUnprocessableEntity)
	expenseCategory := postJSON(t, router, "/api/categories", map[string]any{"name": "Integrity Expense", "kind": "expense"}, http.StatusCreated)
	spendingBucket := postJSON(t, router, "/api/buckets", map[string]any{"name": "Integrity Spending"}, http.StatusCreated)

	requestJSON(t, router, http.MethodPost, "/api/transactions", map[string]any{
		"occurredOn": "2026-08-01", "description": "Invalid same-bucket transfer", "kind": "bucket_transfer",
		"bucketEntries": []map[string]any{{"bucketId": spendingBucket["id"], "amount": "-100"}, {"bucketId": spendingBucket["id"], "amount": "100"}},
	}, http.StatusUnprocessableEntity)
	requestJSON(t, router, http.MethodPost, "/api/transactions", map[string]any{
		"occurredOn": "2026-08-01", "description": "Invalid categorized transfer", "kind": "bucket_transfer",
		"bucketEntries": []map[string]any{{"bucketId": spendingBucket["id"], "categoryId": expenseCategory["id"], "amount": "-100"}, {"bucketId": "00000000-0000-0000-0000-000000000001", "amount": "100"}},
	}, http.StatusUnprocessableEntity)

	expense := postJSON(t, router, "/api/transactions", map[string]any{
		"occurredOn": "2026-08-02", "description": "Archive then reverse", "kind": "expense",
		"postings":      []map[string]any{{"accountId": bank["id"], "amount": "-100"}},
		"bucketEntries": []map[string]any{{"bucketId": spendingBucket["id"], "categoryId": expenseCategory["id"], "amount": "-100"}},
	}, http.StatusCreated)
	requestJSON(t, router, http.MethodPost, "/api/accounts/"+bank["id"].(string)+"/archive", nil, http.StatusNoContent)
	requestJSON(t, router, http.MethodPost, "/api/categories/"+expenseCategory["id"].(string)+"/archive", nil, http.StatusNoContent)
	requestJSON(t, router, http.MethodPost, "/api/buckets/"+spendingBucket["id"].(string)+"/archive", nil, http.StatusNoContent)
	postJSON(t, router, "/api/transactions/"+expense["id"].(string)+"/reverse", map[string]any{"description": "Historical reversal"}, http.StatusCreated)
	if _, err := pool.Exec(context.Background(), `DELETE FROM bucket_entries WHERE transaction_id = $1`, expense["id"]); err == nil {
		t.Fatal("database allowed an entry belonging to a reversed transaction to be changed")
	}

	importBank := postJSON(t, router, "/api/accounts", map[string]any{"name": "Import Bank", "kind": "bank", "balanceClass": "asset", "currency": "INR"}, http.StatusCreated)
	reviewCategory := postJSON(t, router, "/api/categories", map[string]any{"name": "Review Expense", "kind": "expense"}, http.StatusCreated)
	reviewBucket := postJSON(t, router, "/api/buckets", map[string]any{"name": "Review Bucket"}, http.StatusCreated)
	firstImport := uploadCSVForTest(t, router, importBank["id"].(string), "first.csv", "Date,Description,Debit,Credit,Balance\n03/08/2026,Imported expense,1.00,,99.00\n")
	firstBatch := getJSON(t, router, "/api/imports/"+firstImport["id"].(string), http.StatusOK)
	firstRow := firstBatch["rows"].([]any)[0].(map[string]any)
	postJSON(t, router, "/api/transactions/"+firstRow["transactionId"].(string)+"/reverse", map[string]any{"description": "Reverse import"}, http.StatusCreated)
	requestJSON(t, router, http.MethodPut, "/api/imports/rows/"+firstRow["id"].(string)+"/categorization", map[string]any{
		"bucketEntries": []map[string]any{{"bucketId": reviewBucket["id"], "categoryId": reviewCategory["id"], "amount": "-100"}},
	}, http.StatusConflict)
	dashboard := getJSON(t, router, "/api/dashboard", http.StatusOK)
	if dashboard["balanced"] != true {
		t.Fatalf("reversed import review broke coverage equation: %#v", dashboard)
	}

	secondImport := uploadCSVForTest(t, router, importBank["id"].(string), "second.csv", "Date,Description,Debit,Credit,Balance\n04/08/2026,Second expense,2.00,,97.00\n")
	secondBatch := getJSON(t, router, "/api/imports/"+secondImport["id"].(string), http.StatusOK)
	secondRow := secondBatch["rows"].([]any)[0].(map[string]any)
	requestJSON(t, router, http.MethodPost, "/api/buckets/"+reviewBucket["id"].(string)+"/archive", nil, http.StatusNoContent)
	requestJSON(t, router, http.MethodPut, "/api/imports/rows/"+secondRow["id"].(string)+"/categorization", map[string]any{
		"bucketEntries": []map[string]any{{"bucketId": reviewBucket["id"], "categoryId": reviewCategory["id"], "amount": "-200"}},
	}, http.StatusUnprocessableEntity)

	activeReviewBucket := postJSON(t, router, "/api/buckets", map[string]any{"name": "Active Review Bucket"}, http.StatusCreated)
	requestJSON(t, router, http.MethodPost, "/api/categories/"+reviewCategory["id"].(string)+"/archive", nil, http.StatusNoContent)
	thirdImport := uploadCSVForTest(t, router, importBank["id"].(string), "third.csv", "Date,Description,Debit,Credit,Balance\n05/08/2026,Third expense,3.00,,94.00\n")
	thirdBatch := getJSON(t, router, "/api/imports/"+thirdImport["id"].(string), http.StatusOK)
	thirdRow := thirdBatch["rows"].([]any)[0].(map[string]any)
	requestJSON(t, router, http.MethodPut, "/api/imports/rows/"+thirdRow["id"].(string)+"/categorization", map[string]any{
		"bucketEntries": []map[string]any{{"bucketId": activeReviewBucket["id"], "categoryId": reviewCategory["id"], "amount": "-300"}},
	}, http.StatusUnprocessableEntity)

	duplicateOnly := uploadCSVForTest(t, router, importBank["id"].(string), "duplicate.csv", "Date,Description,Debit,Credit,Balance,Ignored\n04/08/2026,Second expense,2.00,,97.00,x\n")
	if duplicateOnly["status"] != "completed" || duplicateOnly["duplicates"] != float64(1) {
		t.Fatalf("duplicate-only batch did not complete: %#v", duplicateOnly)
	}
	imports := getJSON(t, router, "/api/imports?status=completed", http.StatusOK)
	if len(imports["items"].([]any)) == 0 {
		t.Fatal("completed import was not discoverable")
	}
	if _, err := pool.Exec(context.Background(), `
        CREATE FUNCTION test_fail_import_row() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.description = 'explode' THEN
                RAISE EXCEPTION 'injected import failure';
            END IF;
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER test_fail_import_row BEFORE INSERT ON imported_rows
        FOR EACH ROW EXECUTE FUNCTION test_fail_import_row();
    `); err != nil {
		t.Fatal(err)
	}
	uploadCSVForTestStatus(t, router, importBank["id"].(string), "atomic.csv", "Date,Description,Debit,Credit,Balance\n05/08/2026,before failure,1.00,,96.00\n06/08/2026,explode,1.00,,95.00\n", http.StatusInternalServerError)
	var partialBatches, partialTransactions int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM import_batches WHERE file_name='atomic.csv'`).Scan(&partialBatches); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM transactions WHERE description IN ('before failure','explode')`).Scan(&partialTransactions); err != nil {
		t.Fatal(err)
	}
	if partialBatches != 0 || partialTransactions != 0 {
		t.Fatalf("failed import was partially committed: batches=%d transactions=%d", partialBatches, partialTransactions)
	}
	if _, err := pool.Exec(context.Background(), `DROP TRIGGER test_fail_import_row ON imported_rows; DROP FUNCTION test_fail_import_row()`); err != nil {
		t.Fatal(err)
	}

	reconciliationBank := postJSON(t, router, "/api/accounts", map[string]any{"name": "Reconciliation Bank", "kind": "bank", "balanceClass": "asset", "currency": "INR"}, http.StatusCreated)
	postJSON(t, router, "/api/transactions", map[string]any{
		"occurredOn": "2026-08-10", "description": "Opening", "kind": "opening_balance",
		"postings": []map[string]any{{"accountId": reconciliationBank["id"], "amount": "1000"}},
	}, http.StatusCreated)
	requestJSON(t, router, http.MethodPost, "/api/reconciliations", map[string]any{
		"financialAccountId": reconciliationBank["id"], "statementDate": "2026-08-20", "statementBalance": "999", "complete": true,
	}, http.StatusConflict)
	draft := postJSON(t, router, "/api/reconciliations", map[string]any{
		"financialAccountId": reconciliationBank["id"], "statementDate": "2026-08-20", "statementBalance": "999", "complete": false,
	}, http.StatusCreated)
	if draft["computedBalance"] != "1000" || draft["difference"] != "1" {
		t.Fatalf("draft reconciliation did not expose its difference: %#v", draft)
	}
	reconciliationList := getJSON(t, router, "/api/reconciliations", http.StatusOK)
	listedDraft := itemByID(t, reconciliationList, draft["id"].(string))
	if listedDraft["computedBalance"] != "1000" || listedDraft["difference"] != "1" {
		t.Fatalf("listed reconciliation did not expose its current difference: %#v", listedDraft)
	}
	requestJSON(t, router, http.MethodDelete, "/api/reconciliations/"+draft["id"].(string), nil, http.StatusNoContent)
	requestJSON(t, router, http.MethodDelete, "/api/reconciliations/00000000-0000-0000-0000-000000000099", nil, http.StatusNotFound)
	checkpoint := postJSON(t, router, "/api/reconciliations", map[string]any{
		"financialAccountId": reconciliationBank["id"], "statementDate": "2026-08-31", "statementBalance": "1000", "complete": false,
	}, http.StatusCreated)
	requestJSON(t, router, http.MethodPost, "/api/reconciliations/"+checkpoint["id"].(string)+"/complete", nil, http.StatusOK)
	requestJSON(t, router, http.MethodDelete, "/api/reconciliations/"+checkpoint["id"].(string), nil, http.StatusConflict)
	assertReconciliationMembership(t, pool, checkpoint["id"].(string), 1)
	postJSON(t, router, "/api/transactions", map[string]any{
		"occurredOn": "2026-09-10", "description": "September deposit", "kind": "income",
		"postings": []map[string]any{{"accountId": reconciliationBank["id"], "amount": "100"}},
	}, http.StatusCreated)
	later := postJSON(t, router, "/api/reconciliations", map[string]any{
		"financialAccountId": reconciliationBank["id"], "statementDate": "2026-09-30", "statementBalance": "1100", "complete": true,
	}, http.StatusCreated)
	assertReconciliationMembership(t, pool, later["id"].(string), 1)
	requestJSON(t, router, http.MethodPost, "/api/reconciliations/"+checkpoint["id"].(string)+"/reopen", nil, http.StatusConflict)
	requestJSON(t, router, http.MethodPost, "/api/reconciliations/"+later["id"].(string)+"/reopen", nil, http.StatusOK)
	assertReconciliationMembership(t, pool, later["id"].(string), 0)
	requestJSON(t, router, http.MethodPost, "/api/reconciliations/"+later["id"].(string)+"/complete", nil, http.StatusOK)
	assertReconciliationMembership(t, pool, later["id"].(string), 1)
	requestJSON(t, router, http.MethodPost, "/api/reconciliations", map[string]any{
		"financialAccountId": reconciliationBank["id"], "statementDate": "2026-09-15", "statementBalance": "1000", "complete": true,
	}, http.StatusConflict)

	concurrentBank := postJSON(t, router, "/api/accounts", map[string]any{"name": "Concurrent Reconciliation Bank", "kind": "bank", "balanceClass": "asset", "currency": "INR"}, http.StatusCreated)
	statuses := make([]int, 2)
	start := make(chan struct{})
	var wait sync.WaitGroup
	for index, date := range []string{"2026-10-31", "2026-11-30"} {
		wait.Add(1)
		go func(index int, statementDate string) {
			defer wait.Done()
			body, _ := json.Marshal(map[string]any{
				"financialAccountId": concurrentBank["id"], "statementDate": statementDate, "statementBalance": "0", "complete": false,
			})
			<-start
			request := httptest.NewRequest(http.MethodPost, "/api/reconciliations", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			statuses[index] = response.Code
		}(index, date)
	}
	close(start)
	wait.Wait()
	sort.Ints(statuses)
	if statuses[0] != http.StatusCreated || statuses[1] != http.StatusConflict {
		t.Fatalf("concurrent open reconciliations returned %v, want [201 409]", statuses)
	}

	cycleA := id.New()
	cycleB := id.New()
	if _, err := pool.Exec(context.Background(), `INSERT INTO categories(id,name,kind) VALUES($1,'Cycle A','expense'),($2,'Cycle B','expense')`, cycleA, cycleB); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE categories SET parent_id=$1 WHERE id=$2`, cycleA, cycleB); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE categories SET parent_id=$1 WHERE id=$2`, cycleB, cycleA); err == nil {
		t.Fatal("database allowed a category hierarchy cycle")
	}

	invalidTransactionID := id.New()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(context.Background(), `INSERT INTO transactions(id,occurred_on,description,kind,status,origin) VALUES($1,'2026-08-23','Invalid direct transaction','expense','posted','manual')`, invalidTransactionID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err == nil {
		t.Fatal("deferred database invariant allowed a posted transaction without entries")
	}
}

func assertReconciliationMembership(t *testing.T, pool *pgxpool.Pool, reconciliationID string, want int) {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM reconciliation_postings WHERE reconciliation_id=$1`, reconciliationID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("reconciliation %s has %d captured postings, want %d", reconciliationID, count, want)
	}
}

func uploadCSVForTest(t *testing.T, handler http.Handler, accountID, filename, contents string) map[string]any {
	t.Helper()
	return uploadCSVForTestStatus(t, handler, accountID, filename, contents, http.StatusCreated)
}

func uploadCSVForTestStatus(t *testing.T, handler http.Handler, accountID, filename, contents string, wantStatus int) map[string]any {
	t.Helper()
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	if err := writer.WriteField("accountId", accountID); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("mapping", `{"dateColumn":"Date","descriptionColumn":"Description","debitColumn":"Debit","creditColumn":"Credit","balanceColumn":"Balance","dateFormat":"02/01/2006"}`); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(contents)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/imports/csv", &upload)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return performJSON(t, handler, request, wantStatus)
}

func requestJSON(t *testing.T, handler http.Handler, method, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	var requestBody io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		requestBody = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(method, path, requestBody)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return performJSON(t, handler, request, wantStatus)
}
