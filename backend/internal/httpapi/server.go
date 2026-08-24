package httpapi

import (
	"net/http"

	api "github.com/kanishkdudeja/money-matrix/backend/internal/httpapi/generated"
)

// server is the transport adapter generated from openapi/openapi.yaml. Keeping
// it thin makes the checked-in contract the source of truth for routes and
// parameter binding without coupling application logic to the generator.
type server struct {
	database   databasePinger
	catalog    catalogAPI
	ledger     ledgerAPI
	imports    importAPI
	operations operationsAPI
	dashboard  dashboardAPI
}

var _ api.ServerInterface = (*server)(nil)

func (s *server) ListAccounts(w http.ResponseWriter, r *http.Request)  { s.catalog.listAccounts(w, r) }
func (s *server) CreateAccount(w http.ResponseWriter, r *http.Request) { s.catalog.createAccount(w, r) }
func (s *server) UpdateAccount(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.catalog.updateAccount(w, r)
}
func (s *server) ArchiveAccount(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.catalog.archiveAccount(w, r)
}
func (s *server) UnarchiveAccount(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.catalog.unarchiveAccount(w, r)
}
func (s *server) ListBuckets(w http.ResponseWriter, r *http.Request)  { s.catalog.listBuckets(w, r) }
func (s *server) CreateBucket(w http.ResponseWriter, r *http.Request) { s.catalog.createBucket(w, r) }
func (s *server) ArchiveBucket(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.catalog.archiveBucket(w, r)
}
func (s *server) UnarchiveBucket(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.catalog.unarchiveBucket(w, r)
}
func (s *server) ListCategories(w http.ResponseWriter, r *http.Request) {
	s.catalog.listCategories(w, r)
}
func (s *server) CreateCategory(w http.ResponseWriter, r *http.Request) {
	s.catalog.createCategory(w, r)
}
func (s *server) ArchiveCategory(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.catalog.archiveCategory(w, r)
}
func (s *server) UnarchiveCategory(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.catalog.unarchiveCategory(w, r)
}
func (s *server) GetDashboard(w http.ResponseWriter, r *http.Request) { s.dashboard.get(w, r) }
func (s *server) ExportTransactions(w http.ResponseWriter, r *http.Request) {
	s.operations.exportTransactions(w, r)
}
func (s *server) UploadCSVStatement(w http.ResponseWriter, r *http.Request) {
	s.imports.uploadCSV(w, r)
}
func (s *server) ListImportBatches(w http.ResponseWriter, r *http.Request, _ api.ListImportBatchesParams) {
	s.imports.listBatches(w, r)
}
func (s *server) CategorizeImportedRow(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.imports.categorize(w, r)
}
func (s *server) SkipImportedRow(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.imports.skip(w, r)
}
func (s *server) SuggestImportedRowCategorization(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.operations.suggestions(w, r)
}
func (s *server) GetImportBatch(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.imports.getBatch(w, r)
}
func (s *server) ListParserProfiles(w http.ResponseWriter, r *http.Request) {
	s.imports.listProfiles(w, r)
}
func (s *server) CreateParserProfile(w http.ResponseWriter, r *http.Request) {
	s.imports.createProfile(w, r)
}
func (s *server) ListReconciliations(w http.ResponseWriter, r *http.Request) {
	s.operations.listReconciliations(w, r)
}
func (s *server) CreateReconciliation(w http.ResponseWriter, r *http.Request) {
	s.operations.createReconciliation(w, r)
}
func (s *server) CompleteReconciliation(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.operations.completeReconciliation(w, r)
}
func (s *server) DiscardDraftReconciliation(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.operations.discardDraftReconciliation(w, r)
}
func (s *server) ReopenReconciliation(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.operations.reopenReconciliation(w, r)
}
func (s *server) ListCategorizationRules(w http.ResponseWriter, r *http.Request) {
	s.operations.listRules(w, r)
}
func (s *server) CreateCategorizationRule(w http.ResponseWriter, r *http.Request) {
	s.operations.createRule(w, r)
}
func (s *server) DeleteCategorizationRule(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.operations.deleteRule(w, r)
}
func (s *server) ListTransactions(w http.ResponseWriter, r *http.Request, _ api.ListTransactionsParams) {
	s.ledger.list(w, r)
}
func (s *server) CreateTransaction(w http.ResponseWriter, r *http.Request) {
	s.ledger.create(w, r)
}
func (s *server) GetTransaction(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.ledger.get(w, r)
}
func (s *server) ReverseTransaction(w http.ResponseWriter, r *http.Request, _ api.ID) {
	s.ledger.reverse(w, r)
}
func (s *server) GetLiveness(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
func (s *server) GetReadiness(w http.ResponseWriter, r *http.Request) {
	if err := s.database.Ping(r.Context()); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Service unavailable", "database is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
