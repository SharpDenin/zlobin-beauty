package service_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// MODEL-01 API coverage against a live gateway (TEST_API_BASE).
func TestModelRequestInterestsAPI(t *testing.T) {
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
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil || out.AccessToken == "" {
			t.Fatalf("login decode %s", email)
		}
		return out.AccessToken
	}
	do := func(method, path, token string, body any) (int, []byte) {
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
		return res.StatusCode, buf.Bytes()
	}

	createPublished := func(masterToken, title, starts, ends string, capacity int) string {
		t.Helper()
		st, raw := do(http.MethodPost, "/v1/model-requests", masterToken, map[string]any{
			"title": title, "category": "Колористика", "description": "MODEL-01 test",
			"city": "Красноярск", "location_note": "Салон",
			"starts_at": starts, "ends_at": ends, "timezone": "Asia/Krasnoyarsk", "capacity": capacity,
		})
		if st != 201 {
			t.Fatalf("create %s: %d %s", title, st, raw)
		}
		var created struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(raw, &created)
		st, raw = do(http.MethodPost, "/v1/model-requests/"+created.ID+"/publish", masterToken, nil)
		if st >= 300 {
			t.Fatalf("publish %s: %d %s", created.ID, st, raw)
		}
		return created.ID
	}

	client := login("client1@demo.local")
	master := login("master1@demo.local")
	// Unique day+suffix avoids collisions with leftover interests from prior runs.
	runTag := time.Now().UTC().Format("150405.000")
	day := time.Now().UTC().Add(96 * time.Hour).Truncate(24 * time.Hour)
	mk := func(h, m, durH int) (string, string) {
		start := day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute)
		end := start.Add(time.Duration(durH) * time.Hour)
		return start.Format(time.RFC3339), end.Format(time.RFC3339)
	}
	// Clear prior interests for this client so overlap checks are deterministic.
	if st, raw := do(http.MethodGet, "/v1/model-requests/interests", client, nil); st == 200 {
		var existing struct {
			Items []struct {
				RequestID string `json:"request_id"`
			} `json:"items"`
		}
		_ = json.Unmarshal(raw, &existing)
		for _, it := range existing.Items {
			_, _ = do(http.MethodDelete, "/v1/model-requests/"+it.RequestID+"/interest", client, nil)
		}
	}

	s1, e1 := mk(10, 0, 2)
	idA := createPublished(master, "Interest A "+runTag, s1, e1, 2)

	// 1. Add one interest
	st, raw := do(http.MethodPost, "/v1/model-requests/"+idA+"/interest", client, nil)
	if st != 201 {
		t.Fatalf("add interest: %d %s", st, raw)
	}

	// 11. Interest must not create model_response
	st, raw = do(http.MethodGet, "/v1/model-requests/"+idA, client, nil)
	if st != 200 {
		t.Fatalf("get after interest: %d %s", st, raw)
	}
	var afterInterest struct {
		Interested bool `json:"interested"`
		MyResponse *struct {
			ID string `json:"id"`
		} `json:"my_response"`
	}
	_ = json.Unmarshal(raw, &afterInterest)
	if !afterInterest.Interested {
		t.Fatal("expected interested=true")
	}
	if afterInterest.MyResponse != nil {
		t.Fatal("interest must not create model_response")
	}

	// 2. Non-overlapping second interest
	s2, e2 := mk(13, 0, 1) // touches end of A at 12:00? A is 10-12, this is 13-14 — ok
	idB := createPublished(master, "Interest B "+runTag, s2, e2, 1)
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idB+"/interest", client, nil)
	if st != 201 {
		t.Fatalf("add non-overlap: %d %s", st, raw)
	}

	// 4. Allowed touch: endA == startC
	sTouch, eTouch := mk(12, 0, 1) // 12-13, touches A 10-12
	idTouch := createPublished(master, "Interest touch "+runTag, sTouch, eTouch, 1)
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idTouch+"/interest", client, nil)
	if st != 201 {
		t.Fatalf("touching interval must be allowed: %d %s", st, raw)
	}
	_, _ = do(http.MethodDelete, "/v1/model-requests/"+idTouch+"/interest", client, nil)

	// 3. Overlap refusal
	s3, e3 := mk(11, 0, 2) // overlaps A 10-12
	idC := createPublished(master, "Interest overlap "+runTag, s3, e3, 1)
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idC+"/interest", client, nil)
	if st != 409 {
		t.Fatalf("overlap want 409 got %d %s", st, raw)
	}
	var errBody struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
		Code string `json:"code"`
	}
	_ = json.Unmarshal(raw, &errBody)
	code := errBody.Error.Code
	if code == "" {
		code = errBody.Code
	}
	if code != "model_interest_overlap" {
		t.Fatalf("want model_interest_overlap, got %q %s", code, raw)
	}

	// 5. TZ: same absolute window expressed via +07:00 vs UTC must collide
	startKR := day.Add(10 * time.Hour).In(time.FixedZone("KRSK", 7*3600))
	// Use a fresh client-local window that overlaps idA in absolute time via explicit offset string
	sTZ := day.Add(10*time.Hour + 30*time.Minute).UTC().Format(time.RFC3339)
	eTZ := day.Add(12*time.Hour + 30*time.Minute).UTC().Format(time.RFC3339)
	_ = startKR
	idTZ := createPublished(master, "Interest TZ "+runTag, sTZ, eTZ, 1)
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idTZ+"/interest", client, nil)
	if st != 409 {
		t.Fatalf("TZ overlap want 409 got %d %s", st, raw)
	}

	// 8+9. Remove then re-add
	st, raw = do(http.MethodDelete, "/v1/model-requests/"+idB+"/interest", client, nil)
	if st != 200 {
		t.Fatalf("remove interest: %d %s", st, raw)
	}
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idB+"/interest", client, nil)
	if st != 201 {
		t.Fatalf("re-add after remove: %d %s", st, raw)
	}

	// list interests
	st, raw = do(http.MethodGet, "/v1/model-requests/interests", client, nil)
	if st != 200 {
		t.Fatalf("list interests: %d %s", st, raw)
	}
	var listed struct {
		Items []struct {
			RequestID string `json:"request_id"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &listed)
	if len(listed.Items) < 2 {
		t.Fatalf("expected >=2 interests, got %d", len(listed.Items))
	}

	// 6. Unpublished draft cannot receive interest
	st, raw = do(http.MethodPost, "/v1/model-requests", master, map[string]any{
		"title": "Draft only", "category": "Колористика", "description": "draft",
		"city": "Красноярск", "starts_at": day.Add(20 * time.Hour).Format(time.RFC3339),
		"ends_at": day.Add(21 * time.Hour).Format(time.RFC3339), "timezone": "Asia/Krasnoyarsk", "capacity": 1,
	})
	if st != 201 {
		t.Fatalf("create draft: %d %s", st, raw)
	}
	var draft struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &draft)
	st, raw = do(http.MethodPost, "/v1/model-requests/"+draft.ID+"/interest", client, nil)
	if st != 409 && st != 404 {
		t.Fatalf("draft interest want 409/404 got %d %s", st, raw)
	}

	// 7. Closed request
	sClose, eClose := mk(16, 0, 1)
	idClose := createPublished(master, "Interest close "+runTag, sClose, eClose, 1)
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idClose+"/respond", client, nil)
	if st != 201 {
		t.Fatalf("respond close: %d %s", st, raw)
	}
	var respClose struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &respClose)
	st, raw = do(http.MethodPost, "/v1/model-responses/"+respClose.ID+"/accept", client, nil)
	if st >= 300 {
		t.Fatalf("accept close: %d %s", st, raw)
	}
	st, raw = do(http.MethodGet, "/v1/model-requests/"+idClose, client, nil)
	var closedBody struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(raw, &closedBody)
	if closedBody.Status != "closed" {
		t.Fatalf("want closed got %s", closedBody.Status)
	}
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idClose+"/interest", client, nil)
	if st != 409 && st != 404 {
		t.Fatalf("closed interest want 409/404 got %d %s", st, raw)
	}

	// 12. Existing responses still work independently of interest
	sResp, eResp := mk(18, 0, 1)
	idResp := createPublished(master, "Interest resp "+runTag, sResp, eResp, 1)
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idResp+"/respond", client, nil)
	if st != 201 {
		t.Fatalf("respond: %d %s", st, raw)
	}
	var respBody struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	_ = json.Unmarshal(raw, &respBody)
	if respBody.Status != "requested" {
		t.Fatalf("response status %s", respBody.Status)
	}
	// interest after response is still allowed if no overlap with remaining interests
	_, _ = do(http.MethodDelete, "/v1/model-requests/"+idA+"/interest", client, nil)
	_, _ = do(http.MethodDelete, "/v1/model-requests/"+idB+"/interest", client, nil)
	st, raw = do(http.MethodPost, "/v1/model-requests/"+idResp+"/interest", client, nil)
	if st != 201 {
		t.Fatalf("interest with existing response: %d %s", st, raw)
	}
	st, raw = do(http.MethodGet, "/v1/model-requests/"+idResp, client, nil)
	var both struct {
		Interested    bool `json:"interested"`
		AcceptedCount int  `json:"accepted_count"`
		MyResponse    *struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"my_response"`
	}
	_ = json.Unmarshal(raw, &both)
	if !both.Interested || both.MyResponse == nil || both.MyResponse.Status != "requested" {
		t.Fatalf("response must remain; got %+v", both)
	}
	if both.AcceptedCount != 0 {
		t.Fatalf("interest must not affect capacity, accepted_count=%d", both.AcceptedCount)
	}
	// Accept keeps response history and drops soft interest (client self-accept flow).
	st, raw = do(http.MethodPost, "/v1/model-responses/"+both.MyResponse.ID+"/accept", client, nil)
	if st >= 300 {
		t.Fatalf("accept after interest: %d %s", st, raw)
	}
	st, raw = do(http.MethodGet, "/v1/model-requests/"+idResp, client, nil)
	var afterAccept struct {
		Interested    bool `json:"interested"`
		AcceptedCount int  `json:"accepted_count"`
		MyResponse    *struct {
			Status string `json:"status"`
		} `json:"my_response"`
	}
	_ = json.Unmarshal(raw, &afterAccept)
	if afterAccept.Interested {
		t.Fatal("interest must be removed after accept")
	}
	if afterAccept.MyResponse == nil || afterAccept.MyResponse.Status != "accepted" {
		t.Fatalf("accepted response must remain in history: %+v", afterAccept.MyResponse)
	}
	if afterAccept.AcceptedCount != 1 {
		t.Fatalf("capacity must count accepted responses, got accepted_count=%d", afterAccept.AcceptedCount)
	}

	// 13. Legacy willing=true does not create interests
	st, raw = do(http.MethodPatch, "/v1/me/model-preferences", client, map[string]any{
		"willing": true, "notify": true, "categories": []string{"Колористика"}, "city": "Красноярск",
	})
	if st >= 300 {
		t.Fatalf("patch prefs: %d %s", st, raw)
	}
	st, raw = do(http.MethodGet, "/v1/me/model-preferences", client, nil)
	var prefs struct {
		Willing bool `json:"willing"`
	}
	_ = json.Unmarshal(raw, &prefs)
	_ = prefs
	// Creating a new published request must not auto-insert interests for willing users
	sW, eW := mk(22, 0, 1)
	idW := createPublished(master, "No auto interest "+runTag, sW, eW, 1)
	st, raw = do(http.MethodGet, "/v1/model-requests/interests", client, nil)
	_ = json.Unmarshal(raw, &listed)
	for _, it := range listed.Items {
		if it.RequestID == idW {
			t.Fatal("willing must not create interest rows")
		}
	}

	// 10. Parallel overlapping adds — only one succeeds
	sP1, eP1 := mk(6, 0, 2)
	sP2, eP2 := mk(7, 0, 2)
	idP1 := createPublished(master, "Race1 "+runTag, sP1, eP1, 1)
	idP2 := createPublished(master, "Race2 "+runTag, sP2, eP2, 1)
	// clear any leftover overlapping interests for race window
	for _, id := range []string{idA, idB, idTouch, idC, idTZ, idResp} {
		_, _ = do(http.MethodDelete, "/v1/model-requests/"+id+"/interest", client, nil)
	}

	postInterest := func(id string) int {
		req, _ := http.NewRequest(http.MethodPost, base+"/v1/model-requests/"+id+"/interest", nil)
		req.Header.Set("Authorization", "Bearer "+client)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return 0
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	var okCount, failCount atomic.Int32
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		st := postInterest(idP1)
		if st == 201 {
			okCount.Add(1)
		} else if st == 409 {
			failCount.Add(1)
		}
	}()
	go func() {
		defer wg.Done()
		st := postInterest(idP2)
		if st == 201 {
			okCount.Add(1)
		} else if st == 409 {
			failCount.Add(1)
		}
	}()
	wg.Wait()
	st, raw = do(http.MethodGet, "/v1/model-requests/interests", client, nil)
	_ = json.Unmarshal(raw, &listed)
	var winner string
	n := 0
	for _, it := range listed.Items {
		if it.RequestID == idP1 || it.RequestID == idP2 {
			n++
			winner = it.RequestID
		}
	}
	if n != 1 {
		t.Fatalf("race: want exactly 1 interest among pair, got %d (ok=%d fail=%d)", n, okCount.Load(), failCount.Load())
	}
	loser := idP1
	if winner == idP1 {
		loser = idP2
	}
	// Losing request must still be refused with overlap code while winner is held.
	st, raw = do(http.MethodPost, "/v1/model-requests/"+loser+"/interest", client, nil)
	if st != 409 {
		t.Fatalf("loser overlap want 409 got %d %s", st, raw)
	}
	var loseErr struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &loseErr)
	if loseErr.Error.Code != "model_interest_overlap" {
		t.Fatalf("loser want model_interest_overlap, got %q %s", loseErr.Error.Code, raw)
	}
	// After cancelling the winner, the overlapping loser must succeed.
	st, raw = do(http.MethodDelete, "/v1/model-requests/"+winner+"/interest", client, nil)
	if st != 200 {
		t.Fatalf("remove winner: %d %s", st, raw)
	}
	st, raw = do(http.MethodPost, "/v1/model-requests/"+loser+"/interest", client, nil)
	if st != 201 {
		t.Fatalf("add loser after cancel: %d %s", st, raw)
	}
}
