package store

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func commerceTestStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("COMMERCE_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("COMMERCE_DATABASE_URL / DATABASE_URL not set; skip return atomicity integration")
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

// TestReturnClientOrderDebtInsertFailureRollsBack verifies the transactional
// boundary of ReturnClientOrder: when debt_ledger insert fails after the
// operation has begun (FOR UPDATE held), payment_status is not updated and no
// return_credit / history row remains — a subsequent valid return can succeed.
//
// Failure is induced via an invalid debt kind (CHECK constraint), which is the
// supported way to fail insertDebtEntryTx without test-only hooks. There is no
// harness to fail *after* a successful debt insert inside the same TX; that
// would require injecting a store hook. The TX boundary is Begin → debt →
// UPDATE payment_status → history → Commit with defer Rollback.
func TestReturnClientOrderDebtInsertFailureRollsBack(t *testing.T) {
	st := commerceTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	var productID, supplierOrgID = ids.New(), ids.New()
	err := st.pool.QueryRow(ctx, `
SELECT id, organization_id FROM products WHERE published = true LIMIT 1`).Scan(&productID, &supplierOrgID)
	if err != nil {
		t.Skipf("need at least one published product in commerce DB: %v", err)
	}

	userID := ids.New()
	orderID := ids.New()
	actor := ids.New()

	_, err = st.pool.Exec(ctx, `
INSERT INTO client_orders (
  id, user_id, supplier_org_id, status, currency, total_minor,
  delivery_address, delivery_comment, payment_method, payment_status,
  created_at, updated_at
) VALUES (
  $1,$2,$3,'received','RUB',1000,
  'atomic test','','cash','paid',
  $4,$4
)`, orderID, userID, supplierOrgID, now)
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.pool.Exec(context.Background(), `DELETE FROM debt_ledger WHERE ref_id=$1`, orderID)
		_, _ = st.pool.Exec(context.Background(), `DELETE FROM client_order_status_history WHERE order_id=$1`, orderID)
		_, _ = st.pool.Exec(context.Background(), `DELETE FROM client_order_items WHERE order_id=$1`, orderID)
		_, _ = st.pool.Exec(context.Background(), `DELETE FROM client_orders WHERE id=$1`, orderID)
	})

	if _, err = st.pool.Exec(ctx, `
INSERT INTO client_order_items (id, order_id, product_id, product_name, brand, qty, price_minor, qty_delivered)
VALUES ($1,$2,$3,'Atomic Return','Brand',1,1000,1)`, ids.New(), orderID, productID); err != nil {
		t.Fatalf("insert items: %v", err)
	}

	var payBefore string
	if err := st.pool.QueryRow(ctx, `SELECT payment_status FROM client_orders WHERE id=$1`, orderID).Scan(&payBefore); err != nil {
		t.Fatal(err)
	}

	_, err = st.ReturnClientOrder(ctx, ReturnClientOrderParams{
		OrderID:       orderID,
		PaymentStatus: domain.PaymentStatusRefunded,
		Credit: domain.DebtEntry{
			ID: ids.New(), SupplierOrgID: supplierOrgID, ClientUserID: userID,
			Kind: "not_a_real_kind", AmountMinor: -1000,
			RefType: "client_order", RefID: &orderID, Note: "should fail",
			ActorUserID: actor, CreatedAt: now,
		},
		History: domain.ClientOrderStatusHistory{
			ID: ids.New(), OrderID: orderID, FromStatus: domain.ClientOrderStatusReceived,
			ToStatus: domain.ClientOrderStatusReceived, ActorUserID: actor, Note: "fail path", CreatedAt: now,
		},
		Now: now,
	})
	if err == nil {
		t.Fatal("expected debt insert failure")
	}

	var payAfter string
	if err := st.pool.QueryRow(ctx, `SELECT payment_status FROM client_orders WHERE id=$1`, orderID).Scan(&payAfter); err != nil {
		t.Fatal(err)
	}
	if payAfter != payBefore {
		t.Fatalf("payment_status partially updated: before=%q after=%q", payBefore, payAfter)
	}

	var creditCount int
	if err := st.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM debt_ledger
WHERE kind=$1 AND ref_type='client_order' AND ref_id=$2`,
		domain.DebtKindReturnCredit, orderID).Scan(&creditCount); err != nil {
		t.Fatal(err)
	}
	if creditCount != 0 {
		t.Fatalf("return_credit leaked after failed TX, count=%d", creditCount)
	}

	var histCount int
	if err := st.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM client_order_status_history WHERE order_id=$1 AND note = 'fail path'`, orderID).Scan(&histCount); err != nil {
		t.Fatal(err)
	}
	if histCount != 0 {
		t.Fatalf("history leaked after failed TX, count=%d", histCount)
	}

	out, err := st.ReturnClientOrder(ctx, ReturnClientOrderParams{
		OrderID:       orderID,
		PaymentStatus: domain.PaymentStatusRefunded,
		Credit: domain.DebtEntry{
			ID: ids.New(), SupplierOrgID: supplierOrgID, ClientUserID: userID,
			Kind: domain.DebtKindReturnCredit, AmountMinor: -1000,
			RefType: "client_order", RefID: &orderID, Note: "retry ok",
			ActorUserID: actor, CreatedAt: now,
		},
		History: domain.ClientOrderStatusHistory{
			ID: ids.New(), OrderID: orderID, FromStatus: domain.ClientOrderStatusReceived,
			ToStatus: domain.ClientOrderStatusReceived, ActorUserID: actor, Note: "return: retry ok", CreatedAt: now,
		},
		Now: now,
	})
	if err != nil {
		t.Fatalf("retry return: %v", err)
	}
	if out.PaymentStatus != domain.PaymentStatusRefunded {
		t.Fatalf("want refunded, got %s", out.PaymentStatus)
	}
	if err := st.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM debt_ledger
WHERE kind=$1 AND ref_type='client_order' AND ref_id=$2`,
		domain.DebtKindReturnCredit, orderID).Scan(&creditCount); err != nil {
		t.Fatal(err)
	}
	if creditCount != 1 {
		t.Fatalf("want exactly one return_credit after retry, got %d", creditCount)
	}
}

func TestReturnCreditUniqueIndexPresent(t *testing.T) {
	const want = "debt_ledger_return_credit_client_order_uidx"
	st := commerceTestStore(t)
	ctx := context.Background()
	var name string
	if err := st.pool.QueryRow(ctx, `
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND indexname=$1`, want).Scan(&name); err != nil {
		t.Fatalf("index %s missing (migration 016): %v", want, err)
	}
}
