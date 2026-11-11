package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
)

func TestActiveMasterUserIDsFailOpenOnIdentityErrors(t *testing.T) {
	uid := uuid.New()
	rows := []store.SearchMasterRow{{
		Master: domain.MasterProfile{ID: uuid.New(), UserID: uid, Published: true, DisplayName: "Solo"},
	}}

	t.Run("transport error", func(t *testing.T) {
		s := New(nil)
		s.identityURL = "http://127.0.0.1:1"
		s.internalToken = "tok"
		got, err := s.activeMasterUserIDs(context.Background(), rows)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := got[uid]; !ok {
			t.Fatal("identity transport failure must fall open to published SQL hits")
		}
	})

	t.Run("http 500", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		t.Cleanup(ts.Close)
		s := New(nil)
		s.identityURL = ts.URL
		s.internalToken = "tok"
		got, err := s.activeMasterUserIDs(context.Background(), rows)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := got[uid]; !ok {
			t.Fatal("identity 500 must fall open")
		}
	})

	t.Run("filters non-active when identity ok", func(t *testing.T) {
		active := uuid.New()
		deleted := uuid.New()
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"id": active.String(), "display_name": "A", "roles": []string{"master"}, "city": "X"}},
			})
		}))
		t.Cleanup(ts.Close)
		s := New(nil)
		s.identityURL = ts.URL
		s.internalToken = "tok"
		both := []store.SearchMasterRow{
			{Master: domain.MasterProfile{UserID: active}},
			{Master: domain.MasterProfile{UserID: deleted}},
		}
		got, err := s.activeMasterUserIDs(context.Background(), both)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := got[active]; !ok {
			t.Fatal("active user missing")
		}
		if _, ok := got[deleted]; ok {
			t.Fatal("deleted/absent user must stay excluded when identity succeeds")
		}
	})
}
