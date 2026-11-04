package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func bookingTestStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("BOOKING_DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL / BOOKING_DATABASE_URL not set; skip booking store integration")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations"))
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return New(pool)
}

func sampleAppointment(master, client uuid.UUID, start time.Time) domain.Appointment {
	now := time.Now().UTC()
	return domain.Appointment{
		ID:               ids.New(),
		OrganizationID:   ids.New(),
		BranchID:         ids.New(),
		MasterUserID:     master,
		ClientUserID:     client,
		ServiceID:        ids.New(),
		ServiceName:      "concurrency-test",
		DurationMinutes:  60,
		PriceMinor:       1000,
		Currency:         "RUB",
		Status:           domain.StatusPendingConfirmation,
		StartsAt:         start,
		EndsAt:           start.Add(60 * time.Minute),
		BookingMode:      domain.BookingModeFlexible,
		LocationTimezone: "Europe/Moscow",
		CreatedAt:        now,
		UpdatedAt:        now,
	}
}

func isDeadlock(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "40P01"
}

func createWithDeadlockRetry(ctx context.Context, st *Store, a domain.Appointment) error {
	var err error
	for attempt := 0; attempt < 8; attempt++ {
		// Fresh ID each attempt so a prior deadlocked insert that somehow
		// committed is not confused with PK collisions.
		a.ID = ids.New()
		err = st.CreateAppointment(ctx, a)
		if err == nil {
			return nil
		}
		if isDeadlock(err) {
			time.Sleep(time.Duration(10*(attempt+1)) * time.Millisecond)
			continue
		}
		return err
	}
	return err
}

func TestConcurrentCreateSameSlotExclusion(t *testing.T) {
	st := bookingTestStore(t)
	ctx := context.Background()
	master := ids.New()
	start := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Minute)
	t.Cleanup(func() {
		_, _ = st.pool.Exec(ctx, `DELETE FROM appointments WHERE master_user_id=$1 AND service_name='concurrency-test'`, master)
	})

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a := sampleAppointment(master, ids.New(), start)
			errs <- createWithDeadlockRetry(ctx, st, a)
		}()
	}
	wg.Wait()
	close(errs)

	var ok, conflict int
	for err := range errs {
		if err == nil {
			ok++
			continue
		}
		ae, is := apperr.As(err)
		if is && ae.Code == apperr.CodeAppointmentTimeConflict {
			conflict++
			continue
		}
		t.Fatalf("unexpected error: %v", err)
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("want 1 success + 1 appointment_time_conflict, got ok=%d conflict=%d", ok, conflict)
	}
}

func TestRescheduleIntoOccupiedSlotConflict(t *testing.T) {
	st := bookingTestStore(t)
	ctx := context.Background()
	master := ids.New()
	slotA := time.Now().UTC().Add(72 * time.Hour).Truncate(time.Minute)
	slotB := slotA.Add(2 * time.Hour)

	a := sampleAppointment(master, ids.New(), slotA)
	b := sampleAppointment(master, ids.New(), slotB)
	if err := st.CreateAppointment(ctx, a); err != nil {
		t.Fatalf("create a: %v", err)
	}
	if err := st.CreateAppointment(ctx, b); err != nil {
		t.Fatalf("create b: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.pool.Exec(ctx, `DELETE FROM appointments WHERE master_user_id=$1 AND service_name='concurrency-test'`, master)
	})

	err := st.Reschedule(ctx, b.ID, domain.StatusPendingConfirmation, slotA, slotA.Add(60*time.Minute), ids.New(), time.Now().UTC())
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.CodeAppointmentTimeConflict {
		t.Fatalf("want appointment_time_conflict, got %v", err)
	}
}
