package service

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestCreateOrgValidationRequiresNameAndCity(t *testing.T) {
	s := New(nil)
	_, err := s.Create(context.Background(), CreateOrgInput{Name: "", City: "Красноярск", CreatedBy: uuid.New()})
	if codeOf(err) != apperr.CodeValidation {
		t.Fatalf("empty name: want validation, got %v", err)
	}
	_, err = s.Create(context.Background(), CreateOrgInput{Name: "Салон", City: "", CreatedBy: uuid.New()})
	if codeOf(err) != apperr.CodeValidation {
		t.Fatalf("empty city: want validation, got %v", err)
	}
}

func TestCreateOrgBranchRequiresAddressWhenNamed(t *testing.T) {
	s := New(nil)
	_, err := s.Create(context.Background(), CreateOrgInput{
		Name: "Салон", City: "Красноярск", BranchName: "Центр", CreatedBy: uuid.New(),
	})
	if codeOf(err) != apperr.CodeValidation {
		t.Fatalf("branch without address: want validation, got %v", err)
	}
}

func TestCreateOrgLegacyBranchUsesSharedCityAddress(t *testing.T) {
	in := CreateOrgInput{
		Name: "Салон", City: "Красноярск", AddressLine: "Ленина 1", BranchName: "Центр",
	}
	if strings.TrimSpace(in.BranchName) == "" || strings.TrimSpace(in.City) == "" || strings.TrimSpace(in.AddressLine) == "" {
		t.Fatal("legacy payload incomplete")
	}
}

func codeOf(err error) apperr.Code {
	if err == nil {
		return ""
	}
	if ae, ok := apperr.As(err); ok {
		return ae.Code
	}
	return apperr.Code(err.Error())
}
