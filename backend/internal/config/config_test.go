package config

import "testing"

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected missing DATABASE_URL to fail")
	}
}

func TestLoadUsesDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("APP_ENV", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPAddr != ":6060" {
		t.Fatalf("HTTPAddr = %q, want :6060", cfg.HTTPAddr)
	}
	if cfg.Environment != "development" {
		t.Fatalf("Environment = %q, want development", cfg.Environment)
	}
	if cfg.CORSAllowedOrigin != "http://localhost:4040" {
		t.Fatalf("CORSAllowedOrigin = %q, want http://localhost:4040", cfg.CORSAllowedOrigin)
	}
}
