package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Base struct {
	ServiceName string
	HTTPAddr    string
	DatabaseURL string
	LogLevel    string
	JWTSecret   string
	CORSOrigins []string
}

func MustBase(serviceName string) Base {
	ValidateProductionEnv()
	b := Base{
		ServiceName: serviceName,
		HTTPAddr:    getenv("HTTP_ADDR", ":8080"),
		DatabaseURL: mustEnv("DATABASE_URL"),
		LogLevel:    getenv("LOG_LEVEL", "info"),
		JWTSecret:   getenv("JWT_SECRET", ""),
		CORSOrigins: splitCSV(getenv("CORS_ORIGINS", "http://localhost:5173")),
	}
	return b
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(fmt.Sprintf("required env %s is empty", key))
	}
	return v
}

func EnvDuration(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		panic(fmt.Sprintf("invalid duration for %s: %v", key, err))
	}
	return d
}

func EnvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		panic(fmt.Sprintf("invalid int for %s: %v", key, err))
	}
	return n
}

func EnvBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		panic(fmt.Sprintf("invalid bool for %s: %v", key, err))
	}
	return b
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
