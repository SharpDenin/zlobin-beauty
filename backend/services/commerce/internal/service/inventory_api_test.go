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

func TestPhase5MasterInventory(t *testing.T) {
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
	do := func(method, path, token string, body any) (*http.Response, []byte) {
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
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		raw, _ := json.Marshal(struct{}{})
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(res.Body)
		res.Body.Close()
		raw = buf.Bytes()
		return res, raw
	}

	master2 := login("master2@demo.local")
	employee := login("employee1@demo.local")
	supplier := login("supplier1@demo.local")
	otherMaster := login("master1@demo.local")

	orgsOf := func(token string) (orgID, branchID string) {
		t.Helper()
		res, raw := do(http.MethodGet, "/v1/organizations/mine", token, nil)
		if res.StatusCode >= 300 {
			t.Fatalf("orgs mine %d %s", res.StatusCode, raw)
		}
		var out struct {
			Items []struct {
				Organization struct {
					ID   string `json:"id"`
					Type string `json:"type"`
				} `json:"organization"`
				Branches []struct {
					ID string `json:"id"`
				} `json:"branches"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &out)
		for _, it := range out.Items {
			if it.Organization.Type != "supplier" {
				branch := ""
				if len(it.Branches) > 0 {
					branch = it.Branches[0].ID
				}
				return it.Organization.ID, branch
			}
		}
		if len(out.Items) == 0 {
			t.Fatal("no orgs")
		}
		return out.Items[0].Organization.ID, ""
	}

	m2Org, m2Branch := orgsOf(master2)
	supOrg, _ := orgsOf(supplier)

	res, raw := do(http.MethodGet, "/v1/me/inventory?organization_id="+m2Org, master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("ensure inventory %d %s", res.StatusCode, raw)
	}
	var inv struct {
		Location struct {
			ID          string  `json:"id"`
			Kind        string  `json:"kind"`
			OwnerUserID *string `json:"owner_user_id"`
		} `json:"location"`
		Items []struct {
			ProductID string  `json:"product_id"`
			Available float64 `json:"available"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &inv)
	if inv.Location.Kind != "master" || inv.Location.OwnerUserID == nil {
		t.Fatalf("expected master-owned location, got %+v", inv.Location)
	}

	res, raw = do(http.MethodGet, "/v1/commerce/products?organization_id="+supOrg, supplier, nil)
	if res.StatusCode != 200 {
		t.Fatalf("products %d %s", res.StatusCode, raw)
	}
	var products struct {
		Items []struct {
			ID   string `json:"id"`
			SKU  string `json:"sku"`
			Name string `json:"name"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &products)
	var productID string
	for _, p := range products.Items {
		if p.SKU == "S1-LOR-MAJ-001" || p.SKU == "S1-EST-ESX-001" {
			productID = p.ID
			break
		}
	}
	if productID == "" && len(products.Items) > 0 {
		productID = products.Items[0].ID
	}
	if productID == "" {
		t.Fatal("no supplier product")
	}

	// Isolation: employee and supplier cannot read master2 inventory.
	res, _ = do(http.MethodGet, "/v1/me/inventory?organization_id="+m2Org, employee, nil)
	if res.StatusCode == 200 {
		t.Fatal("employee1 must not access master2 org inventory")
	}
	res, raw = do(http.MethodGet, "/v1/commerce/stock?location_id="+inv.Location.ID, supplier, nil)
	if res.StatusCode == 200 {
		t.Fatalf("supplier must not read master location: %s", raw)
	}
	res, _ = do(http.MethodGet, "/v1/commerce/stock?location_id="+inv.Location.ID, otherMaster, nil)
	if res.StatusCode == 200 {
		t.Fatal("other master must not read master2 stock")
	}

	supLocRes, supLocRaw := do(http.MethodGet, "/v1/commerce/locations?organization_id="+supOrg, supplier, nil)
	if supLocRes.StatusCode != 200 {
		t.Fatalf("supplier locations %d %s", supLocRes.StatusCode, supLocRaw)
	}
	var locs struct {
		Items []struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
		} `json:"items"`
	}
	_ = json.Unmarshal(supLocRaw, &locs)
	var supLoc string
	for _, l := range locs.Items {
		if l.Kind == "supplier" {
			supLoc = l.ID
			break
		}
	}
	if supLoc == "" {
		t.Fatal("supplier location missing")
	}
	_, _ = do(http.MethodPost, "/v1/commerce/stock/movements", supplier, map[string]any{
		"location_id": supLoc, "product_id": productID, "kind": "receipt", "qty": 200, "reason": "phase5 test stock",
	})

	orderBody := map[string]any{
		"buyer_org_id": m2Org, "supplier_org_id": supOrg, "location_id": inv.Location.ID,
		"destination_branch_id": m2Branch, "payment_method": "cash",
		"comment": fmt.Sprintf("[test-phase5] %d", time.Now().UnixNano()),
		"items":   []map[string]any{{"product_id": productID, "qty": 100}},
	}
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders", master2, orderBody)
	if res.StatusCode >= 300 {
		t.Fatalf("create order %d %s", res.StatusCode, raw)
	}
	var order struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &order)
	if order.ID == "" {
		t.Fatalf("order id missing %s", raw)
	}

	for _, step := range []string{"confirmed"} {
		res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+order.ID+"/transition", supplier, map[string]any{"status": step})
		if res.StatusCode >= 300 {
			t.Fatalf("transition %s %d %s", step, res.StatusCode, raw)
		}
	}
	window := time.Now().UTC().Add(2 * time.Hour)
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+order.ID+"/delivery/schedule", supplier, map[string]any{
		"window_start": window, "window_end": window.Add(2 * time.Hour), "planned_delivery_at": window,
	})
	if res.StatusCode >= 300 {
		t.Fatalf("schedule %d %s", res.StatusCode, raw)
	}
	est := time.Now().UTC().Add(24 * time.Hour)
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+order.ID+"/transition", supplier, map[string]any{"status": "picking", "estimated_delivery_at": est})
	if res.StatusCode >= 300 {
		t.Fatalf("picking %d %s", res.StatusCode, raw)
	}
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+order.ID+"/transition", supplier, map[string]any{"status": "ready_for_dispatch"})
	if res.StatusCode >= 300 {
		t.Fatalf("ready %d %s", res.StatusCode, raw)
	}
	for _, step := range []string{"in-transit", "arrived", "delivered"} {
		res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+order.ID+"/delivery/"+step, supplier, map[string]any{})
		if res.StatusCode >= 300 {
			t.Fatalf("delivery %s %d %s", step, res.StatusCode, raw)
		}
	}

	stockOf := func() float64 {
		t.Helper()
		res, raw := do(http.MethodGet, "/v1/me/inventory?organization_id="+m2Org, master2, nil)
		if res.StatusCode != 200 {
			t.Fatalf("list stock %d %s", res.StatusCode, raw)
		}
		var cur struct {
			Items []struct {
				ProductID string  `json:"product_id"`
				Available float64 `json:"available"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &cur)
		for _, it := range cur.Items {
			if it.ProductID == productID {
				return it.Available
			}
		}
		return 0
	}
	baseline := stockOf()

	acceptBody := map[string]any{
		"items": []map[string]any{{
			"product_id": productID, "qty_accepted": 80, "qty_damaged": 10, "qty_rejected": 10,
		}},
	}
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+order.ID+"/accept", master2, acceptBody)
	if res.StatusCode != 200 {
		t.Fatalf("accept %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got < baseline+79.9 || got > baseline+80.1 {
		t.Fatalf("after accept available=%v want %v", got, baseline+80)
	}

	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+order.ID+"/accept", master2, acceptBody)
	if res.StatusCode != 200 {
		t.Fatalf("idempotent accept %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got < baseline+79.9 || got > baseline+80.1 {
		t.Fatalf("after second accept available=%v want %v", got, baseline+80)
	}

	res, raw = do(http.MethodGet, "/v1/me/inventory/"+productID+"?organization_id="+m2Org, master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("item details %d %s", res.StatusCode, raw)
	}
	var details struct {
		Movements []struct {
			Kind string  `json:"kind"`
			Qty  float64 `json:"qty"`
		} `json:"movements"`
	}
	_ = json.Unmarshal(raw, &details)
	var hasReceipt, hasDamage, hasReject bool
	for _, m := range details.Movements {
		if m.Kind == "receipt" && m.Qty == 80 {
			hasReceipt = true
		}
		if m.Kind == "damage" && m.Qty == 10 {
			hasDamage = true
		}
		if m.Kind == "rejection" && m.Qty == 10 {
			hasReject = true
		}
	}
	if !hasReceipt || !hasDamage || !hasReject {
		t.Fatalf("expected receipt/damage/rejection movements, got %s", raw)
	}

	txID := fmt.Sprintf("phase5-consume-%d", time.Now().UnixNano())
	consume := map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": 30,
		"appointment_id":  "00000000-0000-0000-0000-000000000456",
		"idempotency_key": txID, "reason": "тест расхода",
	}
	res, raw = do(http.MethodPost, "/v1/me/inventory/consume", master2, consume)
	if res.StatusCode != 200 {
		t.Fatalf("consume %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got < baseline+49.9 || got > baseline+50.1 {
		t.Fatalf("after consume available=%v want %v", got, baseline+50)
	}
	res, raw = do(http.MethodPost, "/v1/me/inventory/consume", master2, consume)
	if res.StatusCode != 200 {
		t.Fatalf("duplicate consume %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got < baseline+49.9 || got > baseline+50.1 {
		t.Fatalf("after duplicate consume available=%v want %v", got, baseline+50)
	}

	overQty := stockOf() + 10
	res, raw = do(http.MethodPost, "/v1/me/inventory/consume", master2, map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": overQty, "reason": "too much",
	})
	if res.StatusCode != 409 {
		t.Fatalf("insufficient want 409 got %d %s", res.StatusCode, raw)
	}
	var errBody struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &errBody)
	if errBody.Error.Code != "insufficient_stock" {
		t.Fatalf("want insufficient_stock got %s", raw)
	}
	if got := stockOf(); got < baseline+49.9 || got > baseline+50.1 {
		t.Fatalf("stock changed after insufficient consume: %v", got)
	}

	res, raw = do(http.MethodPost, "/v1/me/inventory/adjust", master2, map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": -10, "reason": "инвентаризация",
	})
	if res.StatusCode != 200 {
		t.Fatalf("adjust %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got < baseline+39.9 || got > baseline+40.1 {
		t.Fatalf("after adjust available=%v want %v", got, baseline+40)
	}

	res, raw = do(http.MethodPost, "/v1/me/inventory/adjust", master2, map[string]any{
		"organization_id": m2Org, "product_id": productID, "qty": -1,
	})
	if res.StatusCode != 400 {
		t.Fatalf("adjust without reason want 400 got %d %s", res.StatusCode, raw)
	}

	partialComment := fmt.Sprintf("[test-phase5-partial] %d", time.Now().UnixNano())
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders", master2, map[string]any{
		"buyer_org_id": m2Org, "supplier_org_id": supOrg, "location_id": inv.Location.ID,
		"destination_branch_id": m2Branch, "payment_method": "cash",
		"comment": partialComment,
		"items":   []map[string]any{{"product_id": productID, "qty": 10}},
	})
	if res.StatusCode >= 300 {
		t.Fatalf("partial order %d %s", res.StatusCode, raw)
	}
	var partial struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &partial)
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+partial.ID+"/transition", supplier, map[string]any{"status": "confirmed"})
	if res.StatusCode >= 300 {
		t.Fatalf("partial confirm %d %s", res.StatusCode, raw)
	}
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+partial.ID+"/delivery/schedule", supplier, map[string]any{
		"window_start": window, "window_end": window.Add(2 * time.Hour), "planned_delivery_at": window,
	})
	if res.StatusCode >= 300 {
		t.Fatalf("partial schedule %d %s", res.StatusCode, raw)
	}
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+partial.ID+"/transition", supplier, map[string]any{"status": "picking", "estimated_delivery_at": est})
	if res.StatusCode >= 300 {
		t.Fatalf("partial picking %d %s", res.StatusCode, raw)
	}
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+partial.ID+"/transition", supplier, map[string]any{"status": "ready_for_dispatch"})
	if res.StatusCode >= 300 {
		t.Fatalf("partial ready %d %s", res.StatusCode, raw)
	}
	for _, step := range []string{"in-transit", "arrived", "delivered"} {
		res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+partial.ID+"/delivery/"+step, supplier, map[string]any{})
		if res.StatusCode >= 300 {
			t.Fatalf("partial delivery %s %d %s", step, res.StatusCode, raw)
		}
	}
	beforePartial := stockOf()
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+partial.ID+"/accept", master2, map[string]any{
		"items": []map[string]any{{"product_id": productID, "qty_accepted": 6, "qty_damaged": 0, "qty_rejected": 0}},
	})
	if res.StatusCode != 200 {
		t.Fatalf("partial accept %d %s", res.StatusCode, raw)
	}
	if got := stockOf(); got < beforePartial+5.9 || got > beforePartial+6.1 {
		t.Fatalf("partial receipt available=%v want %v", got, beforePartial+6)
	}
	var accepted struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(raw, &accepted)
	if accepted.Status != "accepted_partial" {
		t.Fatalf("want accepted_partial got %s", raw)
	}
}

func TestPhase5ConcurrentConsume(t *testing.T) {
	base := os.Getenv("TEST_API_BASE")
	if base == "" {
		t.Skip("integration test: set TEST_API_BASE to a running gateway")
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
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out struct {
			AccessToken string `json:"access_token"`
		}
		_ = json.NewDecoder(res.Body).Decode(&out)
		return out.AccessToken
	}
	master2 := login("master2@demo.local")
	reqOrgs, _ := http.NewRequest(http.MethodGet, base+"/v1/organizations/mine", nil)
	reqOrgs.Header.Set("Authorization", "Bearer "+master2)
	res, _ := http.DefaultClient.Do(reqOrgs)
	var orgs struct {
		Items []struct {
			Organization struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			} `json:"organization"`
		} `json:"items"`
	}
	_ = json.NewDecoder(res.Body).Decode(&orgs)
	res.Body.Close()
	var orgID string
	for _, it := range orgs.Items {
		if it.Organization.Type != "supplier" {
			orgID = it.Organization.ID
			break
		}
	}
	invReq, _ := http.NewRequest(http.MethodGet, base+"/v1/me/inventory?organization_id="+orgID, nil)
	invReq.Header.Set("Authorization", "Bearer "+master2)
	invRes, _ := http.DefaultClient.Do(invReq)
	var inv struct {
		Location struct {
			ID string `json:"id"`
		} `json:"location"`
		Items []struct {
			ProductID string  `json:"product_id"`
			Available float64 `json:"available"`
		} `json:"items"`
	}
	_ = json.NewDecoder(invRes.Body).Decode(&inv)
	invRes.Body.Close()
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
		t.Skip("master2 warehouse is empty")
	}
	delta := 50 - available
	if delta != 0 {
		bodyAdj, _ := json.Marshal(map[string]any{
			"organization_id": orgID, "product_id": productID, "qty": delta, "reason": "concurrent test set to 50",
		})
		adjReq, _ := http.NewRequest(http.MethodPost, base+"/v1/me/inventory/adjust", bytes.NewReader(bodyAdj))
		adjReq.Header.Set("Authorization", "Bearer "+master2)
		adjReq.Header.Set("Content-Type", "application/json")
		adjRes, err := http.DefaultClient.Do(adjReq)
		if err != nil || adjRes.StatusCode >= 300 {
			raw := []byte{}
			if adjRes != nil {
				buf := new(bytes.Buffer)
				_, _ = buf.ReadFrom(adjRes.Body)
				raw = buf.Bytes()
				adjRes.Body.Close()
			}
			t.Fatalf("set stock to 50: %v %s", err, raw)
		}
		adjRes.Body.Close()
	}

	var okN, failN atomic.Int32
	var wg sync.WaitGroup
	wg.Add(2)
	for i := 0; i < 2; i++ {
		go func(i int) {
			defer wg.Done()
			body, _ := json.Marshal(map[string]any{
				"organization_id": orgID, "product_id": productID, "qty": 30,
				"reason": fmt.Sprintf("concurrent %d", i),
			})
			req, _ := http.NewRequest(http.MethodPost, base+"/v1/me/inventory/consume", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+master2)
			req.Header.Set("Content-Type", "application/json")
			r, err := http.DefaultClient.Do(req)
			if err != nil {
				failN.Add(1)
				return
			}
			defer r.Body.Close()
			if r.StatusCode == 200 {
				okN.Add(1)
			} else {
				failN.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if okN.Load() != 1 || failN.Load() != 1 {
		t.Fatalf("concurrent consume ok=%d fail=%d want 1/1", okN.Load(), failN.Load())
	}
}
