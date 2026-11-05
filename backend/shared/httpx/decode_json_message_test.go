package httpx

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDecodeJSONMessageUnknownField(t *testing.T) {
	type dst struct {
		Name string `json:"name"`
	}
	dec := json.NewDecoder(strings.NewReader(`{"name":"a","published":true}`))
	dec.DisallowUnknownFields()
	err := dec.Decode(&dst{})
	if err == nil {
		t.Fatal("expected unknown field error")
	}
	got := DecodeJSONMessage(err)
	if got != "unknown field: published" {
		t.Fatalf("got %q", got)
	}
}

func TestDecodeJSONMessageEmpty(t *testing.T) {
	if DecodeJSONMessage(errors.New("EOF")) != "empty or truncated json body" {
		t.Fatal("EOF mapping")
	}
	if DecodeJSONMessage(nil) != "invalid json body" {
		t.Fatal("nil mapping")
	}
}
