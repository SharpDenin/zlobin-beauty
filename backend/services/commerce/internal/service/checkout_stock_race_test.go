package service_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestConcurrentCheckoutStockRace exercises backend stock locking when two clients
// checkout the same last unit. Requires a running stack + seed (product S1-RACE-001, qty=1).
// Run: TEST_API_BASE=http://localhost:8090 SEED_PASSWORD=Password123! go test -run StockRace ./...
func TestConcurrentCheckoutStockRace(t *testing.T) {
	base := os.Getenv("TEST_API_BASE")
	if base == "" {
		base = "http://localhost:8090"
	}
	password := os.Getenv("SEED_PASSWORD")
	if password == "" {
		password = "Password123!"
	}

	login := func(email string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"email": email, "password": password})
		res, err := http.Post(base+"/v1/auth/login", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("login %s: %v", email, err)
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			t.Fatalf("login %s status %d", email, res.StatusCode)
		}
		var out struct {
			AccessToken string `json:"access_token"`
		}
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out.AccessToken
	}

	clientA := login("client1@demo.local")
	clientB := login("client3@demo.local")

	productsReq, _ := http.NewRequest(http.MethodGet, base+"/v1/commerce/shop/products?limit=100", nil)
	productsReq.Header.Set("Authorization", "Bearer "+clientA)
	res, err := http.DefaultClient.Do(productsReq)
	if err != nil {
		t.Fatalf("products: %v", err)
	}
	var products struct {
		Items []struct {
			ID   string `json:"id"`
			SKU  string `json:"sku"`
			Name string `json:"name"`
		} `json:"items"`
	}
	_ = json.NewDecoder(res.Body).Decode(&products)
	res.Body.Close()
	var racePID string
	for _, p := range products.Items {
		if p.SKU == "S1-RACE-001" || strings.Contains(p.Name, "Race Test") {
			racePID = p.ID
			break
		}
	}
	if racePID == "" {
		t.Skip("race product S1-RACE-001 not seeded — run seed first")
	}

	supplier := login("supplier1@demo.local")
	var supplierProducts struct {
		Items []struct {
			ID  string `json:"id"`
			SKU string `json:"sku"`
		} `json:"items"`
	}
	sup1OrgReq, _ := http.NewRequest(http.MethodGet, base+"/v1/organizations/mine", nil)
	sup1OrgReq.Header.Set("Authorization", "Bearer "+supplier)
	sup1OrgRes, _ := http.DefaultClient.Do(sup1OrgReq)
	var supOrgs struct {
		Items []struct {
			Organization struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			} `json:"organization"`
		} `json:"items"`
	}
	_ = json.NewDecoder(sup1OrgRes.Body).Decode(&supOrgs)
	sup1OrgRes.Body.Close()
	var sup1OrgID string
	for _, it := range supOrgs.Items {
		if it.Organization.Type == "supplier" {
			sup1OrgID = it.Organization.ID
			break
		}
	}
	prodReq, _ := http.NewRequest(http.MethodGet, base+"/v1/commerce/products?organization_id="+sup1OrgID, nil)
	prodReq.Header.Set("Authorization", "Bearer "+supplier)
	prodRes, _ := http.DefaultClient.Do(prodReq)
	_ = json.NewDecoder(prodRes.Body).Decode(&supplierProducts)
	prodRes.Body.Close()
	var raceProductID string
	for _, p := range supplierProducts.Items {
		if p.SKU == "S1-RACE-001" {
			raceProductID = p.ID
			break
		}
	}
	if raceProductID == "" {
		raceProductID = racePID
	}
	locReq, _ := http.NewRequest(http.MethodGet, base+"/v1/commerce/locations?organization_id="+sup1OrgID, nil)
	locReq.Header.Set("Authorization", "Bearer "+supplier)
	locRes, _ := http.DefaultClient.Do(locReq)
	var locs struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	_ = json.NewDecoder(locRes.Body).Decode(&locs)
	locRes.Body.Close()
	if len(locs.Items) > 0 {
		adjustBody, _ := json.Marshal(map[string]any{
			"location_id": locs.Items[0].ID, "product_id": raceProductID,
			"kind": "receipt", "qty": 1, "reason": "race test reset",
		})
		adjReq, _ := http.NewRequest(http.MethodPost, base+"/v1/commerce/stock/movements", bytes.NewReader(adjustBody))
		adjReq.Header.Set("Authorization", "Bearer "+supplier)
		adjReq.Header.Set("Content-Type", "application/json")
		adjRes, _ := http.DefaultClient.Do(adjReq)
		if adjRes != nil {
			adjRes.Body.Close()
		}
	}

	branchesReq, _ := http.NewRequest(http.MethodGet, base+"/v1/branches/pickup", nil)
	branchesReq.Header.Set("Authorization", "Bearer "+clientA)
	res, err = http.DefaultClient.Do(branchesReq)
	if err != nil {
		t.Fatal(err)
	}
	var branches struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	_ = json.NewDecoder(res.Body).Decode(&branches)
	res.Body.Close()
	if len(branches.Items) == 0 {
		t.Fatal("no pickup branches")
	}
	branchID := branches.Items[0].ID

	tryCheckout := func(token, tag string) (status int, errBody string) {
		putBody, _ := json.Marshal(map[string]any{"product_id": racePID, "qty": 1})
		putReq, _ := http.NewRequest(http.MethodPut, base+"/v1/commerce/shop/cart/items", bytes.NewReader(putBody))
		putReq.Header.Set("Authorization", "Bearer "+token)
		putReq.Header.Set("Content-Type", "application/json")
		putRes, err := http.DefaultClient.Do(putReq)
		if err != nil {
			return 0, err.Error()
		}
		putRes.Body.Close()

		checkoutBody, _ := json.Marshal(map[string]any{
			"delivery_address": "Race Test Address 1",
			"payment_method":   "cash",
			"pickup_branch_id": branchID,
		})
		coReq, _ := http.NewRequest(http.MethodPost, base+"/v1/commerce/shop/checkout", bytes.NewReader(checkoutBody))
		coReq.Header.Set("Authorization", "Bearer "+token)
		coReq.Header.Set("Content-Type", "application/json")
		coReq.Header.Set("Idempotency-Key", "race-"+tag+"-"+time.Now().Format("20060102150405.000"))
		coRes, err := http.DefaultClient.Do(coReq)
		if err != nil {
			return 0, err.Error()
		}
		defer coRes.Body.Close()
		var errMap map[string]any
		_ = json.NewDecoder(coRes.Body).Decode(&errMap)
		if msg, ok := errMap["message"].(string); ok {
			errBody = msg
		}
		return coRes.StatusCode, errBody
	}

	var okCount atomic.Int32
	var failCount atomic.Int32
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		st, _ := tryCheckout(clientA, "a")
		if st == http.StatusCreated {
			okCount.Add(1)
		} else {
			failCount.Add(1)
		}
	}()
	go func() {
		defer wg.Done()
		st, _ := tryCheckout(clientB, "b")
		if st == http.StatusCreated {
			okCount.Add(1)
		} else {
			failCount.Add(1)
		}
	}()
	wg.Wait()

	if okCount.Load() != 1 {
		t.Fatalf("expected exactly 1 successful checkout, got %d (failures=%d)", okCount.Load(), failCount.Load())
	}
	if failCount.Load() != 1 {
		t.Fatalf("expected exactly 1 failed checkout, got failures=%d successes=%d", failCount.Load(), okCount.Load())
	}
}
