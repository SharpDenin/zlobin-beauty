package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type RecurringItemIn struct {
	ProductID uuid.UUID
	Qty       float64
}

type CreateRecurringInput struct {
	SupplierOrgID    uuid.UUID
	BuyerOrgID       uuid.UUID
	PickupBranchID   uuid.UUID
	Frequency        string
	PreferredWeekday *int
	WindowStart      *int
	WindowEnd        *int
	StartDate        time.Time
	HorizonDays      int
	Items            []RecurringItemIn
}

func (s *Service) CreateRecurring(ctx context.Context, actor uuid.UUID, in CreateRecurringInput) (*store.RecurringAgreement, error) {
	freq := strings.ToLower(strings.TrimSpace(in.Frequency))
	if freq != "weekly" && freq != "biweekly" && freq != "monthly" {
		return nil, apperr.Validation("frequency must be weekly, biweekly or monthly")
	}
	if in.SupplierOrgID == uuid.Nil || in.BuyerOrgID == uuid.Nil || in.PickupBranchID == uuid.Nil {
		return nil, apperr.Validation("supplier, buyer and pickup branch are required")
	}
	if len(in.Items) == 0 {
		return nil, apperr.Validation("at least one product is required")
	}
	if err := s.requireMembership(ctx, in.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	if err := s.validateDestinationBranch(ctx, in.PickupBranchID); err != nil {
		return nil, err
	}
	horizon := in.HorizonDays
	if horizon <= 0 {
		horizon = 28
	}
	now := s.now().UTC()
	a := store.RecurringAgreement{
		ID: ids.New(), SupplierOrgID: in.SupplierOrgID, BuyerOrgID: in.BuyerOrgID,
		PickupBranchID: in.PickupBranchID, Frequency: freq, PreferredWeekday: in.PreferredWeekday,
		WindowStartMinute: in.WindowStart, WindowEndMinute: in.WindowEnd,
		StartDate: in.StartDate.UTC(), Status: "pending", HorizonDays: horizon,
		CreatedBy: actor, CreatedAt: now, UpdatedAt: now,
	}
	for _, it := range in.Items {
		p, err := s.getProductOrErr(ctx, it.ProductID)
		if err != nil {
			return nil, err
		}
		if p.OrganizationID != in.SupplierOrgID {
			return nil, apperr.Validation("product does not belong to supplier")
		}
		a.Items = append(a.Items, store.RecurringItem{
			ID: ids.New(), AgreementID: a.ID, ProductID: it.ProductID, Qty: it.Qty, LastKnownPriceMinor: p.PriceMinor,
		})
	}
	if err := s.store.InsertRecurring(ctx, a); err != nil {
		return nil, apperr.Internal(err)
	}
	_ = s.store.InsertCommerceAudit(ctx, actor, "recurring.created", "recurring_agreement", a.ID, "{}", now)
	return &a, nil
}

func (s *Service) ListRecurring(ctx context.Context, actor, orgID uuid.UUID, asSupplier bool) ([]store.RecurringAgreement, error) {
	roles := []string{"owner", "admin", "master"}
	if asSupplier {
		roles = []string{"owner", "admin"}
	}
	if err := s.requireMembership(ctx, orgID, actor, roles...); err != nil {
		return nil, err
	}
	items, err := s.store.ListRecurringByOrg(ctx, orgID, asSupplier)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) DecideRecurring(ctx context.Context, actor, id uuid.UUID, approve bool) (*store.RecurringAgreement, error) {
	a, err := s.store.GetRecurring(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("agreement not found")
	}
	if err := s.requireMembership(ctx, a.SupplierOrgID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	status := "rejected"
	action := "recurring.rejected"
	if approve {
		status = "active"
		action = "recurring.approved"
	}
	if err := s.store.UpdateRecurringStatus(ctx, id, status, &actor, now); err != nil {
		return nil, apperr.Internal(err)
	}
	_ = s.store.InsertCommerceAudit(ctx, actor, action, "recurring_agreement", id, "{}", now)
	a.Status = status
	a.DecidedBy = &actor
	if approve {
		if err := s.generateRecurringHorizon(ctx, a); err != nil {
			return nil, err
		}
	}
	return a, nil
}

type RecurringProposal struct {
	Frequency string   `json:"frequency,omitempty"`
	StartDate string   `json:"start_date,omitempty"`
	Qty       *float64 `json:"qty,omitempty"`
	Reason    string   `json:"reason,omitempty"`
}

func (s *Service) ProposeRecurring(ctx context.Context, actor, id uuid.UUID, p RecurringProposal) (*store.RecurringAgreement, error) {
	a, err := s.store.GetRecurring(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("agreement not found")
	}
	if err := s.requireMembership(ctx, a.SupplierOrgID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	if err := s.store.UpdateRecurringProposal(ctx, id, "pending_reconfirm", raw, now); err != nil {
		return nil, apperr.Internal(err)
	}
	_ = s.store.InsertCommerceAudit(ctx, actor, "recurring.proposed", "recurring_agreement", id, string(raw), now)
	a.Status = "pending_reconfirm"
	a.ProposedChange = raw
	return a, nil
}

func (s *Service) RespondRecurringProposal(ctx context.Context, actor, id uuid.UUID, accept bool) (*store.RecurringAgreement, error) {
	a, err := s.store.GetRecurring(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("agreement not found")
	}
	if err := s.requireMembership(ctx, a.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	if !accept {
		if err := s.store.UpdateRecurringProposal(ctx, id, "pending", []byte("{}"), now); err != nil {
			return nil, apperr.Internal(err)
		}
		a.Status = "pending"
		a.ProposedChange = []byte("{}")
		return a, nil
	}
	var p RecurringProposal
	if len(a.ProposedChange) > 0 {
		_ = json.Unmarshal(a.ProposedChange, &p)
	}
	var start *time.Time
	if p.StartDate != "" {
		if t, err := time.Parse("2006-01-02", p.StartDate); err == nil {
			start = &t
		}
	}
	if err := s.store.ApplyRecurringProposal(ctx, id, p.Frequency, start, p.Qty, now); err != nil {
		return nil, apperr.Internal(err)
	}
	updated, err := s.store.GetRecurring(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if updated != nil && updated.Status == "active" {
		if err := s.generateRecurringHorizon(ctx, updated); err != nil {
			return nil, err
		}
	}
	return updated, nil
}

func (s *Service) SetRecurringStatus(ctx context.Context, actor, id uuid.UUID, status string) (*store.RecurringAgreement, error) {
	a, err := s.store.GetRecurring(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("agreement not found")
	}
	if err := s.requireMembership(ctx, a.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
		if s.requireMembership(ctx, a.SupplierOrgID, actor, "owner", "admin") != nil {
			return nil, err
		}
	}
	allowed := map[string]bool{"paused": true, "active": true, "cancelled": true}
	if !allowed[status] {
		return nil, apperr.Validation("invalid status")
	}
	now := s.now().UTC()
	if err := s.store.UpdateRecurringStatus(ctx, id, status, nil, now); err != nil {
		return nil, apperr.Internal(err)
	}
	_ = s.store.InsertCommerceAudit(ctx, actor, "recurring."+status, "recurring_agreement", id, "{}", now)
	a.Status = status
	if status == "active" {
		if err := s.generateRecurringHorizon(ctx, a); err != nil {
			return nil, err
		}
	}
	return a, nil
}

func (s *Service) generateRecurringHorizon(ctx context.Context, a *store.RecurringAgreement) error {
	locs, err := s.store.ListLocations(ctx, a.BuyerOrgID)
	if err != nil || len(locs) == 0 {
		return apperr.Validation("buyer warehouse location is required")
	}
	until := s.now().UTC().AddDate(0, 0, a.HorizonDays)
	dates := recurringDates(a.StartDate, a.Frequency, a.PreferredWeekday, until)
	for _, day := range dates {
		if day.Before(s.now().UTC().Add(-24 * time.Hour)) {
			continue
		}
		exists, err := s.store.HasGeneratedOccurrence(ctx, a.ID, day)
		if err != nil {
			return apperr.Internal(err)
		}
		if exists {
			continue
		}
		items := make([]OrderItemInput, 0, len(a.Items))
		for _, it := range a.Items {
			p, err := s.getProductOrErr(ctx, it.ProductID)
			if err != nil {
				pid := it.ProductID
				_ = s.store.InsertRecurringException(ctx, ids.New(), a.ID, "product_unavailable", "product missing", &pid, s.now().UTC())
				continue
			}
			if p.ArchivedAt != nil || !p.Published || !p.ForSale {
				pid := it.ProductID
				_ = s.store.InsertRecurringException(ctx, ids.New(), a.ID, "product_unavailable", "product unavailable", &pid, s.now().UTC())
				continue
			}
			if p.PriceMinor != it.LastKnownPriceMinor {
				pid := it.ProductID
				_ = s.store.InsertRecurringException(ctx, ids.New(), a.ID, "price_change",
					fmt.Sprintf("price changed from %d to %d", it.LastKnownPriceMinor, p.PriceMinor), &pid, s.now().UTC())
				continue
			}
			items = append(items, OrderItemInput{ProductID: it.ProductID, QtyOrdered: it.Qty})
		}
		if len(items) == 0 {
			continue
		}
		desired := day
		order, _, err := s.CreateSupplierOrder(ctx, a.CreatedBy, CreateOrderInput{
			BuyerOrgID: a.BuyerOrgID, SupplierOrgID: a.SupplierOrgID, LocationID: locs[0].ID,
			DestinationBranchID: a.PickupBranchID, PaymentMethod: "invoice",
			IdempotencyKey: "recurring:" + a.ID.String() + ":" + day.Format("2006-01-02"),
			Comment:        "Регулярная поставка", DesiredAt: &desired, Items: items,
		})
		if err != nil {
			return err
		}
		if err := s.store.InsertGeneratedOccurrence(ctx, a.ID, day, order.ID, s.now().UTC()); err != nil {
			return apperr.Internal(err)
		}
	}
	return nil
}

func recurringDates(start time.Time, freq string, weekday *int, until time.Time) []time.Time {
	d := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	if weekday != nil {
		want := time.Weekday(*weekday)
		for d.Weekday() != want {
			d = d.AddDate(0, 0, 1)
		}
	}
	var out []time.Time
	for !d.After(until) {
		out = append(out, d)
		switch freq {
		case "biweekly":
			d = d.AddDate(0, 0, 14)
		case "monthly":
			d = d.AddDate(0, 1, 0)
		default:
			d = d.AddDate(0, 0, 7)
		}
		if len(out) > 20 {
			break
		}
	}
	return out
}
