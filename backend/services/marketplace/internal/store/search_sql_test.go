package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSearchMastersSourceContract(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	src, err := os.ReadFile(filepath.Join(filepath.Dir(file), "search.go"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	if !strings.Contains(body, "mp.published = TRUE") && !strings.Contains(body, "mp.published=TRUE") {
		t.Fatal("SearchMasters must filter by published = TRUE")
	}
	for _, frag := range []string{
		"portfolio_items",
		"pi.title",
		"pi.caption",
		"pi.description",
		"pi.category",
		"service_names",
		"price_min_minor",
		"price_max_minor",
		"COALESCE(ms.price_minor_override, svc.price_minor)",
		"ORDER BY city_rank ASC, mp.rating_avg DESC, mp.rating_count DESC, mp.id",
	} {
		if !strings.Contains(body, frag) {
			t.Fatalf("SearchMasters missing %q", frag)
		}
	}
}

func TestSearchServiceNamesLimit(t *testing.T) {
	if searchServiceNamesLimit <= 0 || searchServiceNamesLimit > 20 {
		t.Fatalf("service names cap out of range: %d", searchServiceNamesLimit)
	}
}
