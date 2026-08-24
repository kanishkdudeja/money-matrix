package httpapi

import (
	"net/http"

	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
)

type dashboardAPI struct{ queries *dbgen.Queries }

func (api dashboardAPI) get(w http.ResponseWriter, r *http.Request) {
	row, err := api.queries.GetDashboard(r.Context())
	if err != nil {
		writeDatabaseError(w, err)
		return
	}
	net, ok := checkedSubtract(row.Assets, row.Liabilities)
	if !ok {
		writeProblem(w, http.StatusInternalServerError, "Dashboard overflow", "account totals exceed the supported range")
		return
	}
	difference, ok := checkedSubtract(net, row.Buckets)
	if !ok {
		writeProblem(w, http.StatusInternalServerError, "Dashboard overflow", "allocation totals exceed the supported range")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": formatInt(row.Assets), "liabilities": formatInt(row.Liabilities), "netCovered": formatInt(net), "bucketTotal": formatInt(row.Buckets), "difference": formatInt(difference), "balanced": difference == 0, "importsNeedingReview": row.ImportsNeedingReview})
}
