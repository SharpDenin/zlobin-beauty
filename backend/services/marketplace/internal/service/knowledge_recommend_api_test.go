package service_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestPhase9KnowledgeRecommendations(t *testing.T) {
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
	do := func(method, path, token string) (*http.Response, []byte) {
		t.Helper()
		req, _ := http.NewRequest(method, base+path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
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
	supplier := login("supplier1@demo.local")

	res, raw := do(http.MethodGet, "/v1/knowledge?q=Majirel&limit=5", master2)
	if res.StatusCode != 200 {
		t.Fatalf("knowledge search %d %s", res.StatusCode, raw)
	}
	var list struct {
		Items []struct {
			ID         string   `json:"id"`
			Title      string   `json:"title"`
			ProductID  *string  `json:"product_id"`
			ProductIDs []string `json:"product_ids"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &list)
	if len(list.Items) == 0 {
		t.Fatal("expected seeded Majirel knowledge")
	}
	productID := ""
	if list.Items[0].ProductID != nil {
		productID = *list.Items[0].ProductID
	}
	if productID == "" && len(list.Items[0].ProductIDs) > 0 {
		productID = list.Items[0].ProductIDs[0]
	}
	if productID == "" {
		t.Fatal("seeded article has no product_id")
	}

	res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?product_id="+productID, master2)
	if res.StatusCode != 200 {
		t.Fatalf("recommendations %d %s", res.StatusCode, raw)
	}
	low := strings.ToLower(string(raw))
	if strings.Contains(low, "oxidizer") || strings.Contains(low, "qty_on_hand") || strings.Contains(low, "qty_reserved") || strings.Contains(low, `"components"`) {
		t.Fatalf("recommendations leaked stock or formula: %s", raw)
	}
	var rec struct {
		Items []struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			Context   string `json:"context"`
			ArticleID string `json:"article_id"`
		} `json:"items"`
		EmptyReason string `json:"empty_reason"`
	}
	_ = json.Unmarshal(raw, &rec)
	if len(rec.Items) == 0 {
		t.Fatalf("expected product recommendations %s", raw)
	}
	if rec.Items[0].Context == "" {
		t.Fatal("context required")
	}

	unknown := "00000000-0000-0000-0000-000000000099"
	res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?product_id="+unknown, master2)
	if res.StatusCode != 200 {
		t.Fatalf("empty rec %d %s", res.StatusCode, raw)
	}
	_ = json.Unmarshal(raw, &rec)
	if len(rec.Items) != 0 || rec.EmptyReason == "" {
		t.Fatalf("expected honest empty %s", raw)
	}
	if rec.EmptyReason != "Для этого материала нет сохранённой рекомендации" {
		t.Fatalf("empty reason %s", rec.EmptyReason)
	}

	res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?product_id="+productID, "")
	if res.StatusCode != 401 && res.StatusCode != 403 {
		t.Fatalf("unauth want 401/403 got %d %s", res.StatusCode, raw)
	}

	res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?product_id="+productID, master1)
	if res.StatusCode != 200 {
		t.Fatalf("other master may read public knowledge %d %s", res.StatusCode, raw)
	}
	low = strings.ToLower(string(raw))
	if strings.Contains(low, "qty_on_hand") || strings.Contains(low, "qty_reserved") {
		t.Fatalf("other master must not see stock via knowledge: %s", raw)
	}

	res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?product_id="+productID, client)
	if res.StatusCode != 200 && res.StatusCode != 403 {
		t.Fatalf("client recommendations status %d", res.StatusCode)
	}
	if res.StatusCode == 200 {
		if strings.Contains(strings.ToLower(string(raw)), "qty_on_hand") {
			t.Fatal("client knowledge must not include stock")
		}
	}

	res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?product_id="+productID, supplier)
	if res.StatusCode == 200 {
		if strings.Contains(strings.ToLower(string(raw)), "qty_on_hand") {
			t.Fatal("supplier recommendations must not include master stock")
		}
	}

	assertNoLeak := func(body []byte) {
		t.Helper()
		low := strings.ToLower(string(body))
		for _, needle := range []string{"qty_on_hand", "qty_reserved", "oxidizer", `"components"`, "formula"} {
			if strings.Contains(low, needle) {
				t.Fatalf("recommendations leaked %s: %s", needle, body)
			}
		}
	}

	orgsRes, orgsRaw := do(http.MethodGet, "/v1/organizations/mine", master2)
	if orgsRes.StatusCode == 200 {
		var orgs struct {
			Items []struct {
				Organization struct {
					ID   string `json:"id"`
					Type string `json:"type"`
				} `json:"organization"`
			} `json:"items"`
		}
		_ = json.Unmarshal(orgsRaw, &orgs)
		orgID := ""
		for _, it := range orgs.Items {
			if it.Organization.Type != "supplier" && it.Organization.ID != "" {
				orgID = it.Organization.ID
				break
			}
		}
		profRes, profRaw := do(http.MethodGet, "/v1/me/master", master2)
		if profRes.StatusCode == 200 && orgID != "" {
			var prof struct {
				Services []struct {
					ID string `json:"id"`
				} `json:"services"`
			}
			_ = json.Unmarshal(profRaw, &prof)
			if len(prof.Services) > 0 {
				res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?service_id="+prof.Services[0].ID+"&organization_id="+orgID, master2)
				if res.StatusCode != 200 {
					t.Fatalf("service recommendations %d %s", res.StatusCode, raw)
				}
				assertNoLeak(raw)
			}
		}
	}

	mineRes, mineRaw := do(http.MethodGet, "/v1/appointments/mine?role=master", master2)
	if mineRes.StatusCode == 200 {
		var mine struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		}
		_ = json.Unmarshal(mineRaw, &mine)
		if len(mine.Items) > 0 {
			aid := mine.Items[0].ID
			res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?appointment_id="+aid, master2)
			if res.StatusCode != 200 && res.StatusCode != 403 && res.StatusCode != 404 {
				t.Fatalf("appointment recommendations %d %s", res.StatusCode, raw)
			}
			if res.StatusCode == 200 {
				assertNoLeak(raw)
			}
			res, raw = do(http.MethodGet, "/v1/me/knowledge/recommendations?appointment_id="+aid, master1)
			if res.StatusCode == 200 {
				assertNoLeak(raw)
			} else if res.StatusCode != 403 && res.StatusCode != 404 {
				t.Fatalf("other master appointment context %d %s", res.StatusCode, raw)
			}
		}
	}
}
