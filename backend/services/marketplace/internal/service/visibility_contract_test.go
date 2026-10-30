package service

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPublicMasterAccessOmitsPublishedGate(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	dir := filepath.Dir(file)
	for _, name := range []string{"service.go", "portfolio.go"} {
		src, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		body := string(src)
		switch name {
		case "service.go":
			idx := strings.Index(body, "func (s *Service) GetMaster(")
			if idx < 0 {
				t.Fatal("GetMaster missing")
			}
			chunk := body[idx:]
			if end := strings.Index(chunk, "\nfunc (s *Service)"); end > 0 {
				chunk = chunk[:end]
			}
			if strings.Contains(chunk, "Published") || strings.Contains(chunk, "isMasterPubliclyVisible") || strings.Contains(chunk, "isBranchPublished") {
				t.Fatalf("GetMaster must not gate on published/branch: %s", chunk)
			}
			searchIdx := strings.Index(body, "func (s *Service) Search(")
			if searchIdx < 0 {
				t.Fatal("Search missing")
			}
			searchChunk := body[searchIdx:]
			if end := strings.Index(searchChunk, "\nfunc (s *Service) fetchOnsiteMatches"); end > 0 {
				searchChunk = searchChunk[:end]
			}
			if strings.Contains(searchChunk, "isMasterPubliclyVisible") || strings.Contains(searchChunk, "isBranchPublished") {
				t.Fatal("Search must not gate on published/branch visibility")
			}
		case "portfolio.go":
			idx := strings.Index(body, "func (s *Service) ListMasterPortfolio(")
			if idx < 0 {
				t.Fatal("ListMasterPortfolio missing")
			}
			chunk := body[idx:]
			if end := strings.Index(chunk, "\nfunc (s *Service)"); end > 0 {
				chunk = chunk[:end]
			}
			if strings.Contains(chunk, "Published") || strings.Contains(chunk, "isMasterPubliclyVisible") || strings.Contains(chunk, "isBranchPublished") {
				t.Fatalf("ListMasterPortfolio must not gate on published/branch: %s", chunk)
			}
		}
	}
}
