package domain

import (
	"time"

	"github.com/google/uuid"
)

// Stock location kinds.
const (
	LocationSalon    = "salon"
	LocationMaster   = "master"
	LocationSupplier = "supplier"
	LocationTransit  = "transit"
)

// Stock movement kinds.
const (
	MovementReceipt     = "receipt"
	MovementConsumption = "consumption"
	MovementAdjust      = "adjust"
	MovementWriteOff    = "write_off"
	MovementReturn      = "return"
	MovementReserve     = "reserve"
	MovementUnreserve   = "unreserve"
)

// Stock balance status buckets.
const (
	StockSufficient = "sufficient"
	StockLow        = "low"
	StockCritical   = "critical"
	StockOut        = "out"
)

// Supplier order statuses.
const (
	OrderStatusDraft           = "draft"
	OrderStatusNew             = "new"
	OrderStatusConfirmed       = "confirmed"
	OrderStatusPicking         = "picking"
	OrderStatusInTransit       = "in_transit"
	OrderStatusDelivered       = "delivered"
	OrderStatusAcceptedPartial = "accepted_partial"
	OrderStatusAcceptedFull    = "accepted_full"
	OrderStatusCancelled       = "cancelled"
)

type ProductCategory struct {
	ID        uuid.UUID
	Name      string
	Slug      string
	CreatedAt time.Time
}

type UnitOfMeasure struct {
	ID        uuid.UUID
	Code      string
	Name      string
	CreatedAt time.Time
}

type Product struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	ParentID       *uuid.UUID
	CategoryID     *uuid.UUID
	Brand          string
	Name           string
	SKU            string
	Description    string
	Unit           string
	VolumeLabel    string
	PriceMinor     int64
	Currency       string
	MinStock       float64
	Published      bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type StockLocation struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	Name           string
	Kind           string
	OwnerUserID    *uuid.UUID
	CreatedAt      time.Time
}

type StockBalance struct {
	LocationID  uuid.UUID
	ProductID   uuid.UUID
	QtyOnHand   float64
	QtyReserved float64
	UpdatedAt   time.Time
}

// StockBalanceView is a stock balance joined with the product fields needed
// to render the supplier/salon stock list, plus a computed status bucket.
type StockBalanceView struct {
	StockBalance
	ProductName  string
	ProductBrand string
	ProductSKU   string
	MinStock     float64
	PriceMinor   int64
	Currency     string
	Status       string
}

type StockMovement struct {
	ID          uuid.UUID
	LocationID  uuid.UUID
	ProductID   uuid.UUID
	Kind        string
	Qty         float64
	QtyBefore   float64
	QtyAfter    float64
	Reason      string
	ActorUserID uuid.UUID
	RefType     string
	RefID       *uuid.UUID
	CreatedAt   time.Time
}

type ConsumptionNorm struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	ServiceID      uuid.UUID
	ProductID      uuid.UUID
	Qty            float64
	Required       bool
	CreatedAt      time.Time
}

type SupplierOrder struct {
	ID            uuid.UUID
	BuyerOrgID    uuid.UUID
	SupplierOrgID uuid.UUID
	LocationID    uuid.UUID
	Status        string
	Currency      string
	TotalMinor    int64
	Comment       string
	DesiredAt     *time.Time
	CreatedBy     uuid.UUID
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type SupplierOrderItem struct {
	ID           uuid.UUID
	OrderID      uuid.UUID
	ProductID    uuid.UUID
	QtyOrdered   float64
	QtyDelivered float64
	QtyAccepted  float64
	PriceMinor   int64
}

// Client order statuses (B2C shop).
const (
	ClientOrderStatusSubmitted  = "submitted"
	ClientOrderStatusConfirmed  = "confirmed"
	ClientOrderStatusPicking    = "picking"
	ClientOrderStatusInDelivery = "in_delivery"
	ClientOrderStatusDelivered  = "delivered"
	ClientOrderStatusCancelled  = "cancelled"
)

// Debt ledger entry kinds.
const (
	DebtKindDeliveryCharge = "delivery_charge"
	DebtKindPayment        = "payment"
	DebtKindReturnCredit   = "return_credit"
)

// Import job statuses.
const (
	ImportJobStatusValidated = "validated"
	ImportJobStatusApplied   = "applied"
	ImportJobStatusFailed    = "failed"
)

const ImportJobKindProducts = "products"

type ProductRecommendation struct {
	ID           uuid.UUID
	MasterUserID uuid.UUID
	ProductID    uuid.UUID
	ClientUserID *uuid.UUID
	Comment      string
	ExpiresAt    *time.Time
	CreatedAt    time.Time
}

type ShopRecommendation struct {
	ProductRecommendation
	Product ShopProduct
}

type ShopProduct struct {
	Product
	Available float64
}

type ClientCart struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	UpdatedAt time.Time
	CreatedAt time.Time
}

type ClientCartItem struct {
	CartID    uuid.UUID
	ProductID uuid.UUID
	Qty       float64
	Brand     string
	Name      string
	SKU       string
	Unit      string
	PriceMinor int64
	Currency  string
	Available float64
	OrganizationID uuid.UUID
}

type ClientOrder struct {
	ID                 uuid.UUID
	UserID             uuid.UUID
	SupplierOrgID      uuid.UUID
	Status             string
	Currency           string
	TotalMinor         int64
	DeliveryAddress    string
	DeliveryComment    string
	PaymentMethod      string
	RepUserID          *uuid.UUID
	DeliveredAt        *time.Time
	DeliveryNote       string
	AmountCollectedMinor int64
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type ClientOrderItem struct {
	ID           uuid.UUID
	OrderID      uuid.UUID
	ProductID    uuid.UUID
	ProductName  string
	Brand        string
	Qty          float64
	PriceMinor   int64
	QtyDelivered float64
}

type ClientOrderStatusHistory struct {
	ID          uuid.UUID
	OrderID     uuid.UUID
	FromStatus  string
	ToStatus    string
	ActorUserID uuid.UUID
	Note        string
	CreatedAt   time.Time
}

type DebtEntry struct {
	ID             uuid.UUID
	SupplierOrgID  uuid.UUID
	ClientUserID   uuid.UUID
	Kind           string
	AmountMinor    int64
	RefType        string
	RefID          *uuid.UUID
	Note           string
	ActorUserID    uuid.UUID
	CreatedAt      time.Time
}

type ImportJob struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	Kind           string
	Checksum       string
	Status         string
	Report         []byte
	CreatedBy      uuid.UUID
	CreatedAt      time.Time
}

// StockStatus buckets a stock line based on available quantity (on hand
// minus reserved) versus the product's minimum stock threshold.
func StockStatus(qtyOnHand, qtyReserved, minStock float64) string {
	available := qtyOnHand - qtyReserved
	switch {
	case available <= 0:
		return StockOut
	case available <= minStock/2:
		return StockCritical
	case available <= minStock:
		return StockLow
	default:
		return StockSufficient
	}
}
