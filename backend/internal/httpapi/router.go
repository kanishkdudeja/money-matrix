package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

	databasepkg "github.com/kanishkdudeja/money-matrix/backend/internal/database"
	dbgen "github.com/kanishkdudeja/money-matrix/backend/internal/database/generated"
	api "github.com/kanishkdudeja/money-matrix/backend/internal/httpapi/generated"
	"github.com/kanishkdudeja/money-matrix/backend/internal/importing"
	"github.com/kanishkdudeja/money-matrix/backend/internal/ledger"
	"github.com/kanishkdudeja/money-matrix/backend/internal/reconciliation"
)

type databasePinger interface {
	Ping(context.Context) error
}

func NewRouter(database databasePinger, logger *slog.Logger) http.Handler {
	return newBaseRouter(database, logger)
}

func NewApplicationRouter(database *pgxpool.Pool, logger *slog.Logger, allowedOrigin string) http.Handler {
	router := newMiddlewareRouter(logger)
	specification, err := api.GetSwagger()
	if err != nil {
		panic("load generated OpenAPI specification: " + err.Error())
	}
	router.Use(nethttpmiddleware.OapiRequestValidatorWithOptions(specification, &nethttpmiddleware.Options{
		DoNotValidateServers: true,
		ErrorHandlerWithOpts: func(_ context.Context, validationError error, w http.ResponseWriter, _ *http.Request, options nethttpmiddleware.ErrorHandlerOpts) {
			writeProblem(w, options.StatusCode, "Invalid request", validationError.Error())
		},
	}))
	queries := dbgen.New(database)
	transactor := databasepkg.NewTransactor(database, queries)
	ledgerService := ledger.New(queries, transactor)
	reconciliationService := reconciliation.New(queries, transactor)
	importService := importing.New(transactor)
	if allowedOrigin != "" {
		router.Use(cors(allowedOrigin))
	}
	api.HandlerFromMux(&server{
		database:   database,
		catalog:    catalogAPI{queries: queries},
		ledger:     ledgerAPI{service: ledgerService},
		imports:    importAPI{queries: queries, workflow: importService},
		operations: operationsAPI{queries: queries, reconciliation: reconciliationService},
		dashboard:  dashboardAPI{queries: queries},
	}, router)
	return router
}

func cors(allowedOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Origin") == allowedOrigin {
				w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func newBaseRouter(database databasePinger, logger *slog.Logger) *chi.Mux {
	router := newMiddlewareRouter(logger)

	router.Get("/health/live", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		if err := database.Ping(r.Context()); err != nil {
			writeProblem(w, http.StatusServiceUnavailable, "Service unavailable", "database is unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})

	return router
}

func newMiddlewareRouter(logger *slog.Logger) *chi.Mux {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.Recoverer)
	router.Use(requestLogger(logger))
	router.Use(middleware.Timeout(30 * time.Second))

	return router
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	writeJSONContentType(w, status, "application/json", value)
}

func writeJSONContentType(w http.ResponseWriter, status int, contentType string, value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		http.Error(w, "could not encode response", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	_, _ = w.Write(append(encoded, '\n'))
}

func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(wrapped, r)
			logger.Info("HTTP request", "method", r.Method, "path", r.URL.Path, "status", wrapped.Status(), "bytes", wrapped.BytesWritten(), "duration", time.Since(started))
		})
	}
}
