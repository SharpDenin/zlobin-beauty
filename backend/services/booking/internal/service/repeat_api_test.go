package service_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"testing"
	"time"
)

func TestPhase7RepeatOptionsAuth(t *testing.T) {
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
		if out.AccessToken == "" {
			t.Fatalf("login %s empty token", email)
		}
		return out.AccessToken
	}
	userID := func(token string) string {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, base+"/v1/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out struct {
			ID   string `json:"id"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		}
		_ = json.NewDecoder(res.Body).Decode(&out)
		if out.ID != "" {
			return out.ID
		}
		return out.User.ID
	}
	do := func(method, path, token string) (*http.Response, []byte) {
		t.Helper()
		req, _ := http.NewRequest(method, base+path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(res.Body)
		res.Body.Close()
		return res, buf.Bytes()
	}

	master2 := login("master2@demo.local")
	master1 := login("master1@demo.local")
	client := login("client1@demo.local")
	clientID := userID(client)

	res, raw := do(http.MethodGet, "/v1/me/clients/"+clientID+"/repeat-options", client)
	if res.StatusCode != 403 {
		t.Fatalf("client want 403 got %d %s", res.StatusCode, raw)
	}
	if bytes.Contains(bytes.ToLower(raw), []byte("oxidizer")) || bytes.Contains(bytes.ToLower(raw), []byte("majirel")) {
		t.Fatalf("client response leaked formula: %s", raw)
	}

	res, raw = do(http.MethodGet, "/v1/appointments/mine?role=master", master2)
	if res.StatusCode != 200 {
		t.Fatalf("mine %d %s", res.StatusCode, raw)
	}
	var mine struct {
		Items []struct {
			ID           string `json:"id"`
			Status       string `json:"status"`
			ClientUserID string `json:"client_user_id"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &mine)
	var completed string
	for _, it := range mine.Items {
		if it.Status == "completed" && it.ClientUserID == clientID {
			completed = it.ID
			break
		}
	}
	if completed == "" {
		t.Skip("no completed master2/client1 appointment in seed")
	}

	res, raw = do(http.MethodGet, "/v1/appointments/"+completed+"/repeat-preview", master2)
	if res.StatusCode != 200 {
		t.Fatalf("owner preview %d %s", res.StatusCode, raw)
	}
	var preview struct {
		CanRepeat bool   `json:"can_repeat"`
		Service   string `json:"service"`
	}
	_ = json.Unmarshal(raw, &preview)
	if preview.Service == "" {
		t.Fatalf("expected service name %s", raw)
	}

	res, raw = do(http.MethodGet, "/v1/appointments/"+completed+"/repeat-preview", master1)
	if res.StatusCode != 403 {
		t.Fatalf("other master want 403 got %d %s", res.StatusCode, raw)
	}
	low := bytes.ToLower(raw)
	if bytes.Contains(low, []byte("oxidizer")) || bytes.Contains(raw, []byte("components")) || bytes.Contains(low, []byte("majirel")) {
		t.Fatalf("unauthorized preview leaked formula: %s", raw)
	}

	res, raw = do(http.MethodGet, "/v1/me/clients/"+clientID+"/repeat-options", master2)
	if res.StatusCode != 200 {
		t.Fatalf("repeat-options %d %s", res.StatusCode, raw)
	}
}

func TestPhase7RepeatResources(t *testing.T) {
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
			t.Fatal(err)
		}
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(res.Body)
		res.Body.Close()
		return res, buf.Bytes()
	}

	master2 := login("master2@demo.local")
	master1 := login("master1@demo.local")
	client := login("client1@demo.local")

	reqMe, _ := http.NewRequest(http.MethodGet, base+"/v1/auth/me", nil)
	reqMe.Header.Set("Authorization", "Bearer "+client)
	meRes, _ := http.DefaultClient.Do(reqMe)
	var me struct {
		ID   string `json:"id"`
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	_ = json.NewDecoder(meRes.Body).Decode(&me)
	meRes.Body.Close()
	clientID := me.ID
	if clientID == "" {
		clientID = me.User.ID
	}

	res, raw := do(http.MethodGet, "/v1/appointments/mine?role=master", master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("mine %d %s", res.StatusCode, raw)
	}
	var mine struct {
		Items []struct {
			ID             string    `json:"id"`
			Status         string    `json:"status"`
			ClientUserID   string    `json:"client_user_id"`
			ServiceID      string    `json:"service_id"`
			OrganizationID string    `json:"organization_id"`
			ServiceName    string    `json:"service_name"`
			StartsAt       time.Time `json:"starts_at"`
			PriceMinor     int64     `json:"price_minor"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &mine)
	var src struct {
		ID, ServiceID, OrganizationID, ServiceName string
		StartsAt                                   time.Time
		PriceMinor                                 int64
	}
	for _, it := range mine.Items {
		if it.Status == "completed" && it.ClientUserID == clientID {
			src.ID, src.ServiceID, src.OrganizationID = it.ID, it.ServiceID, it.OrganizationID
			src.ServiceName, src.StartsAt, src.PriceMinor = it.ServiceName, it.StartsAt, it.PriceMinor
			break
		}
	}
	if src.ID == "" {
		t.Skip("no completed master2/client1 appointment")
	}

	res, raw = do(http.MethodGet, "/v1/organizations/mine", master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("orgs %d %s", res.StatusCode, raw)
	}
	var orgs struct {
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
	_ = json.Unmarshal(raw, &orgs)
	orgID := src.OrganizationID
	var branchID string
	for _, it := range orgs.Items {
		if it.Organization.Type != "supplier" {
			if orgID == "" {
				orgID = it.Organization.ID
			}
			if len(it.Branches) > 0 {
				branchID = it.Branches[0].ID
			}
			break
		}
	}

	res, raw = do(http.MethodGet, "/v1/me/inventory?organization_id="+orgID, master2, nil)
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

	supplier := login("supplier1@demo.local")
	res, raw = do(http.MethodGet, "/v1/organizations/mine", supplier, nil)
	var supOrgs struct {
		Items []struct {
			Organization struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			} `json:"organization"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &supOrgs)
	var supOrg string
	for _, it := range supOrgs.Items {
		if it.Organization.Type == "supplier" {
			supOrg = it.Organization.ID
			break
		}
	}
	res, raw = do(http.MethodGet, "/v1/commerce/products?organization_id="+supOrg, supplier, nil)
	var products struct {
		Items []struct {
			ID   string `json:"id"`
			SKU  string `json:"sku"`
			Name string `json:"name"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &products)
	productID := ""
	for _, p := range products.Items {
		if p.SKU == "S1-LOR-MAJ-001" {
			productID = p.ID
			break
		}
	}
	if productID == "" && len(products.Items) > 0 {
		productID = products.Items[0].ID
	}
	if productID == "" {
		t.Fatal("no product")
	}

	res, raw = do(http.MethodPost, "/v1/commerce/norms", master2, map[string]any{
		"organization_id": orgID, "service_id": src.ServiceID, "product_id": productID, "qty": 30, "required": true,
	})
	if res.StatusCode >= 300 {
		t.Fatalf("norm %d %s", res.StatusCode, raw)
	}

	stockOf := func() float64 {
		t.Helper()
		_, raw := do(http.MethodGet, "/v1/me/inventory?organization_id="+orgID, master2, nil)
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
	setStock := func(target float64) {
		t.Helper()
		cur := stockOf()
		delta := target - cur
		if delta > -0.001 && delta < 0.001 {
			return
		}
		res, raw := do(http.MethodPost, "/v1/me/inventory/adjust", master2, map[string]any{
			"organization_id": orgID, "product_id": productID, "qty": delta, "reason": "phase7 test stock",
		})
		if res.StatusCode != 200 {
			t.Fatalf("adjust %d %s", res.StatusCode, raw)
		}
	}

	type reqLine struct {
		ProductID    string  `json:"product_id"`
		RequiredQty  float64 `json:"required_qty"`
		AvailableQty float64 `json:"available_qty"`
		IncomingQty  float64 `json:"incoming_qty"`
		ShortageQty  float64 `json:"shortage_qty"`
		Status       string  `json:"status"`
	}
	type previewDTO struct {
		CanRepeat           bool      `json:"can_repeat"`
		AvailabilityStatus  string    `json:"availability_status"`
		SourceAppointmentID string    `json:"source_appointment_id"`
		Requirements        []reqLine `json:"requirements"`
		Components          []struct {
			Name string `json:"name"`
		} `json:"components"`
	}
	findLine := func(p previewDTO) reqLine {
		for _, r := range p.Requirements {
			if r.ProductID == productID {
				return r
			}
		}
		if len(p.Requirements) == 1 {
			return p.Requirements[0]
		}
		return reqLine{}
	}

	res, raw = do(http.MethodGet, "/v1/appointments/"+src.ID+"/repeat-preview", master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("preview %d %s", res.StatusCode, raw)
	}
	var p previewDTO
	_ = json.Unmarshal(raw, &p)
	line := findLine(p)
	if line.RequiredQty < 0.9 {
		t.Fatalf("expected a material requirement %+v %s", p, raw)
	}
	required := line.RequiredQty
	setStock(required + 10)
	beforePreview := stockOf()
	res, raw = do(http.MethodGet, "/v1/appointments/"+src.ID+"/repeat-preview", master2, nil)
	_ = json.Unmarshal(raw, &p)
	line = findLine(p)
	if line.Status != "available" {
		t.Fatalf("want this product available %+v %s", line, raw)
	}
	if stockOf() != beforePreview {
		t.Fatalf("preview mutated stock")
	}

	setStock(10)
	beforeShortage := stockOf()
	res, raw = do(http.MethodGet, "/v1/appointments/"+src.ID+"/repeat-preview", master2, nil)
	_ = json.Unmarshal(raw, &p)
	line = findLine(p)
	covered := line.AvailableQty + line.IncomingQty
	switch {
	case line.AvailableQty+0.1 >= required:
		if line.Status != "available" || !p.CanRepeat {
			t.Fatalf("stock covers required %+v", p)
		}
	case covered+0.1 >= required:
		if line.Status != "incoming" || p.CanRepeat {
			t.Fatalf("want incoming can_repeat=false %+v %s", p, raw)
		}
		if line.AvailableQty > 10.1 {
			t.Fatalf("incoming must not be counted as stock %+v", line)
		}
	default:
		if line.Status != "shortage" && line.Status != "unavailable" && line.Status != "orderable" {
			t.Fatalf("want shortage/orderable %+v %s", p, raw)
		}
		if p.CanRepeat {
			t.Fatal("can_repeat should be false")
		}
		if line.AvailableQty > 10.1 {
			t.Fatalf("incoming must not be counted as stock %+v", line)
		}
		if p.CanRepeat {
			t.Fatal("can_repeat should be false")
		}
		if line.AvailableQty > 10.1 {
			t.Fatalf("incoming must not be counted as stock %+v", line)
		}
	}
	if stockOf() != beforeShortage {
		t.Fatalf("shortage preview mutated stock")
	}

	res, raw = do(http.MethodGet, "/v1/appointments/"+src.ID+"/repeat-preview", master1, nil)
	if res.StatusCode != 403 {
		t.Fatalf("isolation preview want 403 got %d %s", res.StatusCode, raw)
	}

	res, raw = do(http.MethodGet, "/v1/appointments/"+src.ID+"/scheme", master2, nil)
	if res.StatusCode != 200 {
		t.Fatalf("scheme before %d %s", res.StatusCode, raw)
	}
	schemeBefore := append([]byte(nil), raw...)

	res, raw = do(http.MethodGet, "/v1/me/master", master2, nil)
	var prof struct {
		Master struct {
			ID string `json:"id"`
		} `json:"master"`
		Services []struct {
			ID              string `json:"id"`
			DurationMinutes int    `json:"duration_minutes"`
		} `json:"services"`
	}
	_ = json.Unmarshal(raw, &prof)
	duration := 60
	for _, s := range prof.Services {
		if s.ID == src.ServiceID && s.DurationMinutes > 0 {
			duration = s.DurationMinutes
		}
	}
	master2ID := userIDFromToken(t, base, master2)
	var slot string
	for d := 1; d <= 14 && slot == ""; d++ {
		day := time.Now().UTC().Add(time.Duration(d) * 24 * time.Hour).Format("2006-01-02")
		res, raw = do(http.MethodGet, "/v1/masters/"+master2ID+"/slots?date="+day+"&duration_minutes="+strconv.Itoa(duration), master2, nil)
		var slots struct {
			Items []struct {
				StartsAt string `json:"starts_at"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &slots)
		if len(slots.Items) > 0 {
			slot = slots.Items[0].StartsAt
		}
		_ = res
	}
	if slot == "" {
		t.Skip("no bookable slot for create-repeat")
	}

	stockBeforeCreate := stockOf()
	res, raw = do(http.MethodPost, "/v1/appointments", master2, map[string]any{
		"master_id": prof.Master.ID, "service_id": src.ServiceID, "client_user_id": clientID, "starts_at": slot,
	})
	if res.StatusCode >= 300 {
		t.Fatalf("create repeat %d %s", res.StatusCode, raw)
	}
	var created struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	_ = json.Unmarshal(raw, &created)
	if created.ID == "" || created.ID == src.ID {
		t.Fatalf("new appointment should be independent %s", raw)
	}
	if stockOf() != stockBeforeCreate {
		t.Fatalf("create mutated stock")
	}

	res, raw = do(http.MethodGet, "/v1/appointments/"+src.ID, master2, nil)
	var old struct {
		ID          string    `json:"id"`
		Status      string    `json:"status"`
		ServiceName string    `json:"service_name"`
		PriceMinor  int64     `json:"price_minor"`
		StartsAt    time.Time `json:"starts_at"`
	}
	_ = json.Unmarshal(raw, &old)
	if old.Status != "completed" || old.ServiceName != src.ServiceName || old.PriceMinor != src.PriceMinor {
		t.Fatalf("historical appointment mutated %+v", old)
	}

	res, raw = do(http.MethodGet, "/v1/appointments/"+src.ID+"/scheme", master2, nil)
	if !bytes.Equal(raw, schemeBefore) {
		t.Fatalf("historical scheme mutated")
	}

	_ = branchID
}

func userIDFromToken(t *testing.T, base, token string) string {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, base+"/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		ID   string `json:"id"`
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if out.ID != "" {
		return out.ID
	}
	return out.User.ID
}
