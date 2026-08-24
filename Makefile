SHELL := /bin/sh

ifneq (,$(wildcard .env))
include .env
export
endif

BACKEND_DIR := backend
FRONTEND_DIR := frontend
MIGRATIONS_DIR := database/migrations
GOOSE := go run github.com/pressly/goose/v3/cmd/goose@v3.27.3
SQLC := go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1
OAPI_CODEGEN := go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0

.PHONY: help backend-run backend-build backend-test backend-test-unit backend-race backend-vet backend-vuln backend-fmt backend-fmt-check frontend-install frontend-run frontend-generate frontend-generate-check frontend-typecheck frontend-lint frontend-test frontend-e2e frontend-build frontend-check db-up db-down db-status db-test-up generate generate-check check

help:
	@echo "Money Matrix development commands"
	@echo "  make backend-run    Run the API"
	@echo "  make backend-build  Build the API"
	@echo "  make backend-test   Run backend tests"
	@echo "  make backend-test-unit  Run tests without requiring PostgreSQL"
	@echo "  make backend-race   Run backend tests with the race detector"
	@echo "  make backend-vuln   Run the official Go vulnerability scanner"
	@echo "  make frontend-install  Install exact frontend dependencies"
	@echo "  make frontend-run   Run the frontend development server"
	@echo "  make frontend-test  Run frontend unit and component tests"
	@echo "  make frontend-e2e   Run real-browser workflows against Go and the test database"
	@echo "  make frontend-check Generate, type-check, lint, test, and build frontend"
	@echo "  make db-up          Apply database migrations"
	@echo "  make db-down        Roll back one migration"
	@echo "  make db-status      Show migration status"
	@echo "  make db-test-up     Apply migrations to the test database"
	@echo "  make generate       Generate sqlc and OpenAPI code"
	@echo "  make check          Format, generate, test, and build"

backend-run:
	cd $(BACKEND_DIR) && go run ./cmd/api

backend-build:
	cd $(BACKEND_DIR) && go build ./...

backend-test:
	@test -n "$(TEST_DATABASE_URL)" || (echo "TEST_DATABASE_URL is required for backend-test" >&2; exit 1)
	cd $(BACKEND_DIR) && go test ./...

backend-test-unit:
	cd $(BACKEND_DIR) && env -u TEST_DATABASE_URL go test ./...

backend-race:
	@test -n "$(TEST_DATABASE_URL)" || (echo "TEST_DATABASE_URL is required for backend-race" >&2; exit 1)
	cd $(BACKEND_DIR) && go test -race ./...

backend-vet:
	cd $(BACKEND_DIR) && go vet ./...

backend-vuln:
	cd $(BACKEND_DIR) && go run golang.org/x/vuln/cmd/govulncheck@v1.7.0 ./...

backend-fmt:
	cd $(BACKEND_DIR) && gofmt -w $$(find . -name '*.go' -not -path './internal/database/generated/*' -not -path './internal/httpapi/generated/*')

backend-fmt-check:
	@test -z "$$(gofmt -l $(BACKEND_DIR))" || (gofmt -l $(BACKEND_DIR); echo "Go files need formatting" >&2; exit 1)

frontend-install:
	cd $(FRONTEND_DIR) && npm ci

frontend-run:
	cd $(FRONTEND_DIR) && npm run dev

frontend-generate:
	cd $(FRONTEND_DIR) && npm run generate:api

frontend-generate-check: frontend-generate
	@git diff --exit-code -- $(FRONTEND_DIR)/src/api/generated.d.ts

frontend-typecheck:
	cd $(FRONTEND_DIR) && npm run typecheck

frontend-lint:
	cd $(FRONTEND_DIR) && npm run lint

frontend-test:
	cd $(FRONTEND_DIR) && npm test

frontend-e2e:
	cd $(FRONTEND_DIR) && npm run test:e2e

frontend-build:
	cd $(FRONTEND_DIR) && npm run build

frontend-check: frontend-generate-check frontend-typecheck frontend-lint frontend-test frontend-build

db-up:
	cd $(BACKEND_DIR) && $(GOOSE) -dir $(MIGRATIONS_DIR) postgres "$(DATABASE_URL)" up

db-down:
	cd $(BACKEND_DIR) && $(GOOSE) -dir $(MIGRATIONS_DIR) postgres "$(DATABASE_URL)" down

db-status:
	cd $(BACKEND_DIR) && $(GOOSE) -dir $(MIGRATIONS_DIR) postgres "$(DATABASE_URL)" status

db-test-up:
	cd $(BACKEND_DIR) && $(GOOSE) -dir $(MIGRATIONS_DIR) postgres "$(TEST_DATABASE_URL)" up

generate:
	cd $(BACKEND_DIR) && $(SQLC) generate
	cd $(BACKEND_DIR) && $(OAPI_CODEGEN) --config openapi/oapi-codegen.yaml openapi/openapi.yaml
	cd $(FRONTEND_DIR) && npm run generate:api

generate-check: generate
	@git diff --exit-code -- $(BACKEND_DIR)/internal/database/generated $(BACKEND_DIR)/internal/httpapi/generated $(FRONTEND_DIR)/src/api/generated.d.ts

check: backend-fmt-check generate-check backend-test backend-race backend-vet backend-build backend-vuln frontend-typecheck frontend-lint frontend-test frontend-build
