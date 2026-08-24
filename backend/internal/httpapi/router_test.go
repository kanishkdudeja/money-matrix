package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakePinger struct{ err error }

func (p fakePinger) Ping(context.Context) error { return p.err }

func TestLiveness(t *testing.T) {
	router := NewRouter(fakePinger{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestReadinessFailsWhenDatabaseIsUnavailable(t *testing.T) {
	router := NewRouter(fakePinger{err: errors.New("unavailable")}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/problem+json" {
		t.Fatalf("content type = %q, want application/problem+json", contentType)
	}
}

func TestNullableStringDistinguishesMissingNullAndValue(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name      string
		body      string
		wantSet   bool
		wantValue *string
	}{
		{name: "missing", body: `{}`},
		{name: "null", body: `{"note":null}`, wantSet: true},
		{name: "value", body: `{"note":"memo"}`, wantSet: true, wantValue: stringPointer("memo")},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var value struct {
				Note nullableString `json:"note"`
			}
			if err := json.Unmarshal([]byte(test.body), &value); err != nil {
				t.Fatal(err)
			}
			if value.Note.Set != test.wantSet || !equalStringPointers(value.Note.Value, test.wantValue) {
				t.Fatalf("decoded note = %#v", value.Note)
			}
		})
	}
}

func stringPointer(value string) *string { return &value }

func equalStringPointers(left, right *string) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}
