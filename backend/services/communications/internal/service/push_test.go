package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func TestNotificationTarget(t *testing.T) {
	id := uuid.Must(uuid.NewV7())
	if got := notificationTarget("appointment", &id); got != "/appointments/"+id.String() {
		t.Fatalf("appointment: %s", got)
	}
	if got := notificationTarget("conversation", &id); got != "/messages/"+id.String() {
		t.Fatalf("conversation: %s", got)
	}
	if got := notificationTarget("hair_consultation", &id); got != "/consultations/"+id.String() {
		t.Fatalf("hair_consultation: %s", got)
	}
	if got := notificationTarget("unknown", &id); got != "/notifications" {
		t.Fatalf("fallback: %s", got)
	}
	if got := notificationTarget("appointment", nil); got != "/notifications" {
		t.Fatalf("nil id: %s", got)
	}
}

func TestPushEnabledRequiresBothKeys(t *testing.T) {
	s := New(nil, "").WithPush("", "priv", "mailto:a@b.c")
	if s.PushEnabled() || s.PushPublicKey() != "" {
		t.Fatal("missing public key must disable push")
	}
	s = New(nil, "").WithPush("pub", "", "mailto:a@b.c")
	if s.PushEnabled() {
		t.Fatal("missing private key must disable push")
	}
	s = New(nil, "").WithPush("pub", "priv", "")
	if !s.PushEnabled() || s.PushPublicKey() != "pub" {
		t.Fatal("both keys enable push")
	}
	if s.vapidSubject != "no-reply@salon-x.ru" {
		t.Fatalf("default subject: %s", s.vapidSubject)
	}
}

func TestNormalizeVAPIDSubject(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "no-reply@salon-x.ru"},
		{"mailto:no-reply@salon-x.ru", "no-reply@salon-x.ru"},
		{"no-reply@salon-x.ru", "no-reply@salon-x.ru"},
		{"  mailto:ops@example.com  ", "ops@example.com"},
		{"https://salon-x.example", "https://salon-x.example"},
	}
	for _, tc := range cases {
		got := normalizeVAPIDSubject(tc.in)
		if got != tc.want {
			t.Fatalf("normalizeVAPIDSubject(%q)=%q want %q", tc.in, got, tc.want)
		}
		// Simulate webpush-go: prepend mailto: unless https:
		final := got
		if !strings.HasPrefix(final, "https:") {
			final = "mailto:" + final
		}
		if strings.Contains(final, "mailto:mailto:") {
			t.Fatalf("double mailto for input %q → %q", tc.in, final)
		}
	}
}

func TestPushEndpointHost(t *testing.T) {
	if got := pushEndpointHost("https://fcm.googleapis.com/fcm/send/TOKEN"); got != "fcm.googleapis.com" {
		t.Fatalf("got %q", got)
	}
	if got := pushEndpointHost(""); got != "" {
		t.Fatalf("empty: %q", got)
	}
}

type memPushSubs struct {
	mu      sync.Mutex
	subs    []domain.PushSubscription
	deleted []string
}

func (m *memPushSubs) ListPushSubscriptions(_ context.Context, userID uuid.UUID) ([]domain.PushSubscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.PushSubscription
	for _, s := range m.subs {
		if s.UserID == userID {
			out = append(out, s)
		}
	}
	return out, nil
}

func (m *memPushSubs) DeletePushSubscription(_ context.Context, userID uuid.UUID, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deleted = append(m.deleted, endpoint)
	filtered := m.subs[:0]
	for _, s := range m.subs {
		if !(s.UserID == userID && s.Endpoint == endpoint) {
			filtered = append(filtered, s)
		}
	}
	m.subs = filtered
	return nil
}

type fakeSender struct {
	mu      sync.Mutex
	calls   int
	status  map[string]int
	failFor map[string]error
	last    []byte
}

func (f *fakeSender) Send(_ context.Context, sub domain.PushSubscription, payload []byte, _, _, _ string) (int, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.last = append([]byte(nil), payload...)
	if err, ok := f.failFor[sub.Endpoint]; ok {
		return 0, "", err
	}
	if st, ok := f.status[sub.Endpoint]; ok {
		body := ""
		if st == http.StatusUnauthorized {
			body = "invalid VAPID JWT"
		}
		return st, body, nil
	}
	return http.StatusCreated, "", nil
}

func TestDispatchPushMultiDeviceAndGoneCleanup(t *testing.T) {
	user := ids.New()
	repo := &memPushSubs{subs: []domain.PushSubscription{
		{ID: ids.New(), UserID: user, Endpoint: "https://push.example/a", P256dh: "x", Auth: "y", CreatedAt: time.Now()},
		{ID: ids.New(), UserID: user, Endpoint: "https://push.example/b", P256dh: "x", Auth: "y", CreatedAt: time.Now()},
	}}
	sender := &fakeSender{status: map[string]int{
		"https://push.example/a": http.StatusCreated,
		"https://push.example/b": http.StatusGone,
	}}
	svc := New(nil, "").WithPush("pub", "priv", "mailto:t@example.com")
	svc.pushSubs = repo
	svc.pushSender = sender
	svc.syncPush = true

	svc.dispatchPush(context.Background(), user, "Title", "Body", "conversation", nil)

	if sender.calls != 2 {
		t.Fatalf("want 2 sends, got %d", sender.calls)
	}
	if len(repo.deleted) != 1 || repo.deleted[0] != "https://push.example/b" {
		t.Fatalf("gone endpoint should be deleted: %#v", repo.deleted)
	}
	left, _ := repo.ListPushSubscriptions(context.Background(), user)
	if len(left) != 1 || left[0].Endpoint != "https://push.example/a" {
		t.Fatalf("left=%#v", left)
	}
}

func TestDispatchPushTemporaryErrorKeepsSubscription(t *testing.T) {
	user := ids.New()
	repo := &memPushSubs{subs: []domain.PushSubscription{
		{ID: ids.New(), UserID: user, Endpoint: "https://push.example/tmp", P256dh: "x", Auth: "y"},
	}}
	sender := &fakeSender{
		failFor: map[string]error{"https://push.example/tmp": errors.New("timeout")},
	}
	svc := New(nil, "").WithPush("pub", "priv", "mailto:t@example.com")
	svc.pushSubs = repo
	svc.pushSender = sender
	svc.dispatchPush(context.Background(), user, "T", "B", "", nil)
	left, _ := repo.ListPushSubscriptions(context.Background(), user)
	if len(left) != 1 {
		t.Fatal("temporary failure must keep subscription")
	}
}

func TestDispatchPushNoVAPIDNoop(t *testing.T) {
	sender := &fakeSender{}
	svc := New(nil, "")
	svc.pushSender = sender
	svc.pushSubs = &memPushSubs{subs: []domain.PushSubscription{{UserID: ids.New(), Endpoint: "e"}}}
	svc.dispatchPush(context.Background(), ids.New(), "T", "B", "", nil)
	if sender.calls != 0 {
		t.Fatal("disabled push must not send")
	}
}

func TestDispatchPushUnauthorizedKeepsSubscription(t *testing.T) {
	user := ids.New()
	repo := &memPushSubs{subs: []domain.PushSubscription{
		{ID: ids.New(), UserID: user, Endpoint: "https://fcm.googleapis.com/fcm/send/x", P256dh: "x", Auth: "y"},
	}}
	sender := &fakeSender{status: map[string]int{
		"https://fcm.googleapis.com/fcm/send/x": http.StatusUnauthorized,
	}}
	svc := New(nil, "").WithPush("pub", "priv", "mailto:t@example.com")
	svc.pushSubs = repo
	svc.pushSender = sender
	svc.dispatchPush(context.Background(), user, "T", "B", "appointment", nil)
	left, _ := repo.ListPushSubscriptions(context.Background(), user)
	if len(left) != 1 {
		t.Fatal("401 must keep subscription (ops may fix VAPID without forcing re-opt-in)")
	}
}

func TestTruncatePushDiag(t *testing.T) {
	if got := truncatePushDiag("  hello\nworld  ", 20); got != "helloworld" {
		t.Fatalf("got %q", got)
	}
	long := strings.Repeat("a", 200)
	if got := truncatePushDiag(long, 10); got != "aaaaaaaaaa…" {
		t.Fatalf("got %q", got)
	}
}

func TestPushTTLConstant(t *testing.T) {
	if pushTTLSeconds < 3600 {
		t.Fatalf("TTL too short for offline devices: %d", pushTTLSeconds)
	}
}
