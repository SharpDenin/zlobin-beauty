package service_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestPhase8AvailabilityAnalyzer(t *testing.T) {
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
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(res.Body)
		res.Body.Close()
		return res, buf.Bytes()
	}
	orgsOf := func(token string, wantSupplier bool) (orgID, branchID string) {
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
			isSup := it.Organization.Type == "supplier"
			if isSup == wantSupplier {
				branch := ""
				if len(it.Branches) > 0 {
					branch = it.Branches[0].ID
				}
				return it.Organization.ID, branch
			}
		}
		t.Fatal("matching org not found")
		return "", ""
	}

	master2 := login("master2@demo.local")
	master1 := login("master1@demo.local")
	supplier := login("supplier1@demo.local")
	employee := login("employee1@demo.local")
	m2Org, m2Branch := orgsOf(master2, false)
	supOrg, _ := orgsOf(supplier, true)

	res, raw := do(http.MethodGet, "/v1/me/master", master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("me master %d %s", res.StatusCode, raw)
	}
	var prof struct {
		Services []struct {
			ID string `json:"id"`
		} `json:"services"`
	}
	_ = json.Unmarshal(raw, &prof)
	if len(prof.Services) == 0 {
		t.Fatal("master2 has no services")
	}
	serviceID := prof.Services[0].ID

	sku := fmt.Sprintf("P8-%d", time.Now().UnixNano())
	res, raw = do(http.MethodPost, "/v1/commerce/products", supplier, map[string]any{
		"organization_id": supOrg, "name": "Phase8 Analyzer Dye", "brand": "Test",
		"sku": sku, "unit": "ml", "price_minor": 9900, "currency": "RUB", "published": true, "for_sale": true,
	})
	if res.StatusCode >= 300 {
		t.Fatalf("create product %d %s", res.StatusCode, raw)
	}
	var product struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &product)
	if product.ID == "" {
		t.Fatalf("product id missing %s", raw)
	}

	res, raw = do(http.MethodPost, "/v1/commerce/products", supplier, map[string]any{
		"organization_id": supOrg, "name": "Phase8 Hidden Dye", "brand": "Test",
		"sku": sku + "-U", "unit": "ml", "price_minor": 9900, "currency": "RUB", "published": false, "for_sale": false,
	})
	if res.StatusCode >= 300 {
		t.Fatalf("create unpublished %d %s", res.StatusCode, raw)
	}
	var hidden struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &hidden)

	res, raw = do(http.MethodGet, "/v1/commerce/locations?organization_id="+supOrg, supplier, nil)
	if res.StatusCode != 200 {
		t.Fatalf("supplier locations %d %s", res.StatusCode, raw)
	}
	var locs struct {
		Items []struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &locs)
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
		"location_id": supLoc, "product_id": product.ID, "kind": "receipt", "qty": 200, "reason": "phase8 supplier stock",
	})

	res, raw = do(http.MethodPost, "/v1/commerce/norms", master2, map[string]any{
		"organization_id": m2Org, "service_id": serviceID, "product_id": product.ID, "qty": 30, "required": true,
	})
	if res.StatusCode >= 300 {
		t.Fatalf("norm %d %s", res.StatusCode, raw)
	}

	res, raw = do(http.MethodGet, "/v1/me/inventory?organization_id="+m2Org, master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("inventory %d %s", res.StatusCode, raw)
	}
	var inv struct {
		Location struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
		} `json:"location"`
	}
	_ = json.Unmarshal(raw, &inv)
	if inv.Location.Kind != "master" {
		t.Fatalf("expected master location %+v", inv.Location)
	}

	type item struct {
		ProductID   string  `json:"product_id"`
		RequiredQty float64 `json:"required_qty"`
		OnHand      float64 `json:"on_hand"`
		Reserved    float64 `json:"reserved"`
		Available   float64 `json:"available"`
		Incoming    float64 `json:"incoming"`
		Shortage    float64 `json:"shortage"`
		Status      string  `json:"status"`
		Orderable   bool    `json:"orderable"`
	}
	type analysis struct {
		ServiceID      string `json:"service_id"`
		CanPerformNow  bool   `json:"can_perform_now"`
		Status         string `json:"availability_status"`
		Items          []item `json:"items"`
		Alternative    struct {
			Available bool   `json:"available"`
			Reason    string `json:"reason"`
		} `json:"alternative"`
	}
	find := func(a analysis) item {
		for _, it := range a.Items {
			if it.ProductID == product.ID {
				return it
			}
		}
		return item{}
	}
	analyze := func(token string) (int, analysis, []byte) {
		t.Helper()
		res, raw := do(http.MethodGet, "/v1/me/inventory/availability?organization_id="+m2Org+"&service_id="+serviceID, token, nil)
		var out analysis
		_ = json.Unmarshal(raw, &out)
		return res.StatusCode, out, raw
	}
	stockOf := func() float64 {
		t.Helper()
		_, raw := do(http.MethodGet, "/v1/me/inventory?organization_id="+m2Org, master2, nil)
		var cur struct {
			Items []struct {
				ProductID string  `json:"product_id"`
				Available float64 `json:"available"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &cur)
		for _, it := range cur.Items {
			if it.ProductID == product.ID {
				return it.Available
			}
		}
		return 0
	}
	setStock := func(target float64) {
		t.Helper()
		delta := target - stockOf()
		if delta > -0.001 && delta < 0.001 {
			return
		}
		res, raw := do(http.MethodPost, "/v1/me/inventory/adjust", master2, map[string]any{
			"organization_id": m2Org, "product_id": product.ID, "qty": delta, "reason": "phase8 test stock",
		})
		if res.StatusCode != 200 {
			t.Fatalf("adjust %d %s", res.StatusCode, raw)
		}
	}
	coverOthers := func() {
		t.Helper()
		res, raw := do(http.MethodGet, "/v1/commerce/norms?organization_id="+m2Org+"&service_id="+serviceID, master2, nil)
		if res.StatusCode != 200 {
			t.Fatalf("list norms %d %s", res.StatusCode, raw)
		}
		var body struct {
			Items []struct {
				ProductID string  `json:"product_id"`
				Qty       float64 `json:"qty"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &body)
		for _, n := range body.Items {
			if n.ProductID == product.ID || n.ProductID == hidden.ID {
				continue
			}
			_, raw := do(http.MethodGet, "/v1/me/inventory?organization_id="+m2Org, master2, nil)
			var cur struct {
				Items []struct {
					ProductID string  `json:"product_id"`
					Available float64 `json:"available"`
				} `json:"items"`
			}
			_ = json.Unmarshal(raw, &cur)
			have := 0.0
			for _, it := range cur.Items {
				if it.ProductID == n.ProductID {
					have = it.Available
				}
			}
			need := n.Qty + 50 - have
			if need > 0.001 {
				_, _ = do(http.MethodPost, "/v1/me/inventory/adjust", master2, map[string]any{
					"organization_id": m2Org, "product_id": n.ProductID, "qty": need, "reason": "phase8 cover other norms",
				})
			}
		}
	}

	coverOthers()

	// DEMO A — available from master stock only
	setStock(100)
	status, body, raw := analyze(master2)
	if status != 200 {
		t.Fatalf("available %d %s", status, raw)
	}
	line := find(body)
	if line.RequiredQty != 30 || line.Available < 99.9 || line.Status != "available" || !body.CanPerformNow {
		t.Fatalf("DEMO A %+v %s", body, raw)
	}
	if line.Available != line.OnHand-line.Reserved {
		t.Fatalf("available must be on_hand-reserved %+v", line)
	}
	if bytes.Contains(bytes.ToLower(raw), []byte("oxidizer")) || bytes.Contains(bytes.ToLower(raw), []byte("components")) {
		t.Fatalf("availability leaked formula fields: %s", raw)
	}

	// DEMO B / D — shortage of catalog product is orderable
	setStock(10)
	status, body, raw = analyze(master2)
	if status != 200 {
		t.Fatalf("shortage %d %s", status, raw)
	}
	line = find(body)
	if line.Available < 9.9 || line.Available > 10.1 || line.Shortage < 19.9 || line.Shortage > 20.1 {
		t.Fatalf("DEMO B quantities %+v", line)
	}
	if line.Status != "orderable" || !line.Orderable || body.CanPerformNow {
		t.Fatalf("DEMO D orderable %+v %s", line, raw)
	}
	if line.Incoming != 0 {
		t.Fatalf("no incoming yet %+v", line)
	}

	// DEMO C — incoming covers the gap but is not stock
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders", master2, map[string]any{
		"buyer_org_id": m2Org, "supplier_org_id": supOrg, "location_id": inv.Location.ID,
		"destination_branch_id": m2Branch, "payment_method": "cash",
		"comment": fmt.Sprintf("[test-phase8-incoming] %d", time.Now().UnixNano()),
		"items":   []map[string]any{{"product_id": product.ID, "qty": 20}},
	})
	if res.StatusCode >= 300 {
		t.Fatalf("create incoming order %d %s", res.StatusCode, raw)
	}
	var order struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &order)
	res, raw = do(http.MethodPost, "/v1/commerce/supplier-orders/"+order.ID+"/transition", supplier, map[string]any{"status": "confirmed"})
	if res.StatusCode >= 300 {
		t.Fatalf("confirm %d %s", res.StatusCode, raw)
	}
	status, body, raw = analyze(master2)
	if status != 200 {
		t.Fatalf("incoming analyze %d %s", status, raw)
	}
	line = find(body)
	if line.Available > 10.1 || line.Incoming < 19.9 || line.Status != "incoming" || body.CanPerformNow {
		t.Fatalf("DEMO C incoming is not stock %+v %s", line, raw)
	}

	// DEMO E — unpublished product cannot be ordered
	res, raw = do(http.MethodPost, "/v1/commerce/norms", master2, map[string]any{
		"organization_id": m2Org, "service_id": serviceID, "product_id": hidden.ID, "qty": 5, "required": true,
	})
	if res.StatusCode >= 300 {
		t.Fatalf("hidden norm %d %s", res.StatusCode, raw)
	}
	status, body, raw = analyze(master2)
	if status != 200 {
		t.Fatalf("unavailable analyze %d %s", status, raw)
	}
	var hiddenLine item
	for _, it := range body.Items {
		if it.ProductID == hidden.ID {
			hiddenLine = it
		}
	}
	if hiddenLine.Status != "unavailable" || hiddenLine.Orderable {
		t.Fatalf("DEMO E unpublished must be unavailable %+v %s", hiddenLine, raw)
	}

	// DEMO H — isolation
	status, _, raw = analyze(master1)
	if status == 200 {
		var other analysis
		_ = json.Unmarshal(raw, &other)
		for _, it := range other.Items {
			if it.ProductID == product.ID && it.Available > 0.1 {
				t.Fatalf("master1 must not see master2 stock %+v", it)
			}
		}
	}
	res, _ = do(http.MethodGet, "/v1/me/inventory/availability?organization_id="+m2Org+"&service_id="+serviceID, employee, nil)
	if res.StatusCode == 200 {
		t.Fatal("employee must not analyze master inventory")
	}
	res, _ = do(http.MethodGet, "/v1/me/inventory/availability?organization_id="+m2Org+"&service_id="+serviceID, supplier, nil)
	if res.StatusCode == 200 {
		t.Fatal("supplier must not analyze master inventory")
	}

	// DEMO J — salon stock is not a fallback
	res, raw = do(http.MethodGet, "/v1/commerce/locations?organization_id="+m2Org, master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("salon locations %d %s", res.StatusCode, raw)
	}
	_ = json.Unmarshal(raw, &locs)
	var salonLoc string
	for _, l := range locs.Items {
		if l.Kind == "salon" {
			salonLoc = l.ID
			break
		}
	}
	if salonLoc == "" {
		res, raw = do(http.MethodPost, "/v1/commerce/locations", master2, map[string]any{
			"organization_id": m2Org, "name": "Склад салона", "kind": "salon",
		})
		if res.StatusCode >= 300 {
			t.Fatalf("create salon loc %d %s", res.StatusCode, raw)
		}
		var created struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(raw, &created)
		salonLoc = created.ID
	}
	setStock(0)
	_, _ = do(http.MethodPost, "/v1/commerce/stock/movements", master2, map[string]any{
		"location_id": salonLoc, "product_id": product.ID, "kind": "receipt", "qty": 500, "reason": "phase8 salon fallback bait",
	})
	status, body, raw = analyze(master2)
	if status != 200 {
		t.Fatalf("salon fallback analyze %d %s", status, raw)
	}
	line = find(body)
	if line.Available > 0.1 || line.OnHand > 0.1 {
		t.Fatalf("DEMO J salon stock must not count as master available %+v %s", line, raw)
	}

	if body.Alternative.Available {
		t.Fatal("no invented formula alternative")
	}
	if body.Alternative.Reason == "" {
		t.Fatal("honest unavailable alternative reason expected")
	}
}
