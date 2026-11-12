package service_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestStockAdjustAndReceiptIdempotency covers server-side Idempotency-Key for
// POST /v1/me/inventory/adjust and POST /v1/commerce/stock/movements (receipt).
func TestStockAdjustAndReceiptIdempotency(t *testing.T) {
	base := os.Getenv("TEST_API_BASE")
	if base == "" {
		t.Skip("integration test: set TEST_API_BASE to a running gateway (e.g. http://localhost:8090)")
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

	do := func(method, path, token, idem string, body any) (*http.Response, []byte) {
		t.Helper()
		var rdr *bytes.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rdr = bytes.NewReader(b)
		} else {
			rdr = bytes.NewReader(nil)
		}
		req, _ := http.NewRequest(method, base+path, rdr)
		req.Header.Set("Authorization", "Bearer "+token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if idem != "" {
			req.Header.Set("Idempotency-Key", idem)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(res.Body)
		res.Body.Close()
		return res, buf.Bytes()
	}

	master2 := login("master2@demo.local")
	master1 := login("master1@demo.local")
	supplier := login("supplier1@demo.local")

	orgsOf := func(token string) (orgID string) {
		t.Helper()
		res, raw := do(http.MethodGet, "/v1/organizations/mine", token, "", nil)
		if res.StatusCode >= 300 {
			t.Fatalf("orgs %d %s", res.StatusCode, raw)
		}
		var out struct {
			Items []struct {
				Organization struct {
					ID   string `json:"id"`
					Type string `json:"type"`
				} `json:"organization"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &out)
		for _, it := range out.Items {
			if it.Organization.Type != "supplier" {
				return it.Organization.ID
			}
		}
		t.Fatal("no salon org")
		return ""
	}

	m2Org := orgsOf(master2)
	m1Org := orgsOf(master1)

	res, raw := do(http.MethodGet, "/v1/me/inventory?organization_id="+m2Org, master2, "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("inventory %d %s", res.StatusCode, raw)
	}
	var inv struct {
		Location struct {
			ID string `json:"id"`
		} `json:"location"`
		Items []struct {
			ProductID string  `json:"product_id"`
			Available float64 `json:"available"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &inv)
	if inv.Location.ID == "" {
		t.Fatal("master location missing")
	}
	var productID string
	var available float64
	for _, it := range inv.Items {
		productID = it.ProductID
		available = it.Available
		break
	}
	if productID == "" {
		t.Skip("master2 inventory empty — seed required")
	}

	stockOf := func() float64 {
		t.Helper()
		res, raw := do(http.MethodGet, "/v1/me/inventory?organization_id="+m2Org, master2, "", nil)
		if res.StatusCode != 200 {
			t.Fatalf("stock list %d %s", res.StatusCode, raw)
		}
		var out struct {
			Items []struct {
				ProductID string  `json:"product_id"`
				Available float64 `json:"available"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &out)
		for _, it := range out.Items {
			if it.ProductID == productID {
				return it.Available
			}
		}
		return 0
	}

	countMovements := func(token, path string) int {
		t.Helper()
		res, raw := do(http.MethodGet, path, token, "", nil)
		if res.StatusCode != 200 {
			t.Fatalf("movements %d %s", res.StatusCode, raw)
		}
		var out struct {
			Items []struct {
				ID             string `json:"id"`
				IdempotencyKey string `json:"idempotency_key"`
				Qty            float64 `json:"qty"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &out)
		return len(out.Items)
	}

	tag := fmt.Sprintf("%d", time.Now().UnixNano())
	before := stockOf()

	// 1–2: first adjust + replay same key/payload
	idemAdjust := "adj-idem-" + tag
	bodyAdj := map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": 3, "reason": "idem adjust " + tag,
	}
	res, raw = do(http.MethodPost, "/v1/me/inventory/adjust", master2, idemAdjust, bodyAdj)
	if res.StatusCode != 200 {
		t.Fatalf("adjust1 %d %s", res.StatusCode, raw)
	}
	var mov1 struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &mov1)
	after1 := stockOf()
	if after1 < before+2.9 || after1 > before+3.1 {
		t.Fatalf("after adjust1 stock=%v want %v", after1, before+3)
	}
	res, raw = do(http.MethodPost, "/v1/me/inventory/adjust", master2, idemAdjust, bodyAdj)
	if res.StatusCode != 200 {
		t.Fatalf("adjust replay %d %s", res.StatusCode, raw)
	}
	var movReplay struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &movReplay)
	if movReplay.ID != mov1.ID {
		t.Fatalf("replay should return same movement id %s vs %s", mov1.ID, movReplay.ID)
	}
	if got := stockOf(); got != after1 {
		t.Fatalf("replay mutated stock %v → %v", after1, got)
	}

	// 3: same key, different payload → conflict
	res, raw = do(http.MethodPost, "/v1/me/inventory/adjust", master2, idemAdjust, map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": 9, "reason": "idem adjust " + tag,
	})
	if res.StatusCode != 409 {
		t.Fatalf("payload conflict want 409 got %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got != after1 {
		t.Fatalf("conflict mutated stock")
	}

	// 4: concurrent same key — single stock delta
	idemConc := "adj-conc-" + tag
	beforeConc := stockOf()
	var okN, failN atomic.Int32
	var wg sync.WaitGroup
	wg.Add(2)
	for i := 0; i < 2; i++ {
		go func() {
			defer wg.Done()
			res, _ := do(http.MethodPost, "/v1/me/inventory/adjust", master2, idemConc, map[string]any{
				"organization_id": m2Org, "product_id": productID, "qty": 2, "reason": "conc " + tag,
			})
			if res.StatusCode == 200 {
				okN.Add(1)
			} else {
				failN.Add(1)
			}
		}()
	}
	wg.Wait()
	if okN.Load() != 2 || failN.Load() != 0 {
		t.Fatalf("concurrent adjust ok=%d fail=%d", okN.Load(), failN.Load())
	}
	if got := stockOf(); got < beforeConc+1.9 || got > beforeConc+2.1 {
		t.Fatalf("concurrent stock=%v want %v", got, beforeConc+2)
	}

	// 5: failed validation must not block later use of the same client key
	idemFail := "adj-fail-" + tag
	res, raw = do(http.MethodPost, "/v1/me/inventory/adjust", master2, idemFail, map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": 0, "reason": "fail " + tag,
	})
	if res.StatusCode == 200 {
		t.Fatalf("qty=0 must fail, got 200 %s", raw)
	}
	beforeFail := stockOf()
	res, raw = do(http.MethodPost, "/v1/me/inventory/adjust", master2, idemFail, map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": 1, "reason": "fail recover " + tag,
	})
	if res.StatusCode != 200 {
		t.Fatalf("reuse key after validation failure %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got < beforeFail+0.9 || got > beforeFail+1.1 {
		t.Fatalf("after recover stock=%v", got)
	}

	// 8: two independent keys both apply
	beforeTwo := stockOf()
	res, _ = do(http.MethodPost, "/v1/me/inventory/adjust", master2, "adj-a-"+tag, map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": 1, "reason": "a " + tag,
	})
	if res.StatusCode != 200 {
		t.Fatalf("key A %d", res.StatusCode)
	}
	res, _ = do(http.MethodPost, "/v1/me/inventory/adjust", master2, "adj-b-"+tag, map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": 1, "reason": "b " + tag,
	})
	if res.StatusCode != 200 {
		t.Fatalf("key B %d", res.StatusCode)
	}
	if got := stockOf(); got < beforeTwo+1.9 || got > beforeTwo+2.1 {
		t.Fatalf("two keys stock=%v want %v", got, beforeTwo+2)
	}

	// 10: isolation — master1 same client key must not mutate master2 stock
	_ = available
	stockBeforeOther := stockOf()
	res, raw = do(http.MethodPost, "/v1/me/inventory/adjust", master1, idemAdjust, map[string]any{
		"organization_id": m1Org, "product_id": productID, "qty": 1, "reason": "other user " + tag,
	})
	if res.StatusCode != 200 && res.StatusCode != 400 && res.StatusCode != 403 && res.StatusCode != 404 && res.StatusCode != 409 {
		t.Logf("master1 isolation probe status %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got != stockBeforeOther {
		t.Fatalf("master1 request mutated master2 stock %v → %v", stockBeforeOther, got)
	}

	// Salon / supplier receipt idempotency.
	res, raw = do(http.MethodGet, "/v1/commerce/locations?organization_id="+orgsOf(supplier), supplier, "", nil)
	if res.StatusCode != 200 {
		res, raw = do(http.MethodGet, "/v1/commerce/locations?organization_id="+m2Org, master2, "", nil)
	}
	var locs struct {
		Items []struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &locs)
	var salonLoc string
	actor := master2
	orgForLoc := m2Org
	for _, l := range locs.Items {
		if l.Kind == "salon" || l.Kind == "supplier" {
			salonLoc = l.ID
			break
		}
	}
	if salonLoc == "" && len(locs.Items) > 0 {
		salonLoc = locs.Items[0].ID
	}
	if salonLoc == "" {
		t.Log("skip receipt tests: no stock location")
		return
	}

	listStock := func(token, loc string) float64 {
		res, raw := do(http.MethodGet, "/v1/commerce/stock?location_id="+loc, token, "", nil)
		if res.StatusCode != 200 {
			return -1
		}
		var out struct {
			Items []struct {
				ProductID string  `json:"product_id"`
				QtyOnHand float64 `json:"qty_on_hand"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &out)
		for _, it := range out.Items {
			if it.ProductID == productID {
				return it.QtyOnHand
			}
		}
		return 0
	}

	beforeR := listStock(actor, salonLoc)
	if beforeR < 0 {
		actor = supplier
		beforeR = listStock(actor, salonLoc)
		if beforeR < 0 {
			t.Log("skip receipt: cannot list stock")
			return
		}
	}
	_ = orgForLoc
	idemR := "rcpt-" + tag
	bodyR := map[string]any{
		"location_id": salonLoc, "product_id": productID, "kind": "receipt", "qty": 4, "reason": "receipt " + tag,
	}
	res, raw = do(http.MethodPost, "/v1/commerce/stock/movements", actor, idemR, bodyR)
	if res.StatusCode != 201 && res.StatusCode != 200 {
		t.Fatalf("receipt1 %d %s", res.StatusCode, raw)
	}
	var r1 struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &r1)
	afterR := listStock(actor, salonLoc)
	if afterR < beforeR+3.9 || afterR > beforeR+4.1 {
		t.Fatalf("receipt stock %v → %v", beforeR, afterR)
	}
	res, raw = do(http.MethodPost, "/v1/commerce/stock/movements", actor, idemR, bodyR)
	if res.StatusCode != 201 && res.StatusCode != 200 {
		t.Fatalf("receipt replay %d %s", res.StatusCode, raw)
	}
	var r2 struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &r2)
	if r1.ID != "" && r2.ID != "" && r1.ID != r2.ID {
		t.Fatalf("receipt replay id mismatch %s vs %s", r1.ID, r2.ID)
	}
	if got := listStock(actor, salonLoc); got != afterR {
		t.Fatalf("receipt replay mutated %v → %v", afterR, got)
	}
	res, raw = do(http.MethodPost, "/v1/commerce/stock/movements", actor, idemR, map[string]any{
		"location_id": salonLoc, "product_id": productID, "kind": "receipt", "qty": 7, "reason": "receipt " + tag,
	})
	if res.StatusCode != 409 {
		t.Fatalf("receipt payload conflict want 409 got %d %s", res.StatusCode, raw)
	}

	_ = countMovements
}
