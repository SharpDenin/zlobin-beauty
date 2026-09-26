package service

import (
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func TestAdminKnowledgeStatusValidation(t *testing.T) {
	if _, err := resolveArticleStatus("published", nil, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveArticleStatus("draft", nil, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveArticleStatus("archived", nil, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveArticleStatus("mystery", nil, ""); err == nil {
		t.Fatal("invalid status must fail")
	}
	_ = domain.KnowledgeStatusPublished
}
