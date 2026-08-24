package config

import (
	"errors"
	"os"
)

type Config struct {
	DatabaseURL       string
	HTTPAddr          string
	Environment       string
	CORSAllowedOrigin string
}

func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		HTTPAddr:          valueOrDefault("HTTP_ADDR", ":8080"),
		Environment:       valueOrDefault("APP_ENV", "development"),
		CORSAllowedOrigin: valueOrDefault("CORS_ALLOWED_ORIGIN", "http://localhost:5173"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	return cfg, nil
}

func valueOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
