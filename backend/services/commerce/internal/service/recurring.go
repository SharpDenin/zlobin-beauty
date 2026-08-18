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
	IntervalWeeks    int
	PreferredWeekday *int
	WindowStart      *int
	WindowEnd        *int
	StartDate        time.Time
	EndDate          *time.Time
	HorizonDays      int
	Items            []RecurringItemIn
}

func normalizeFrequency(freq string, interval int) (string, int, error) {
	freq = strings.ToLower(strings.TrimSpace(freq))
	if interval <= 0 {
		interval = 1
	}
	switch freq {
	case "weekly":
		return "weekly", 1, nil
	case "biweekly":
		return "every_n_weeks", 2, nil
	case "every_n_weeks":
		if interval < 1 || interval > 12 {
			return "", 0, apperr.Validation("interval_weeks must be 1-12")
		}
		return "every_n_weeks", interval, nil
	case "monthly":
		return "monthly", interval, nil
	default:
		return "", 0, apperr.Validation("frequency must be weekly, every_n_weeks or monthly")
	}
}

func (s *Service) CreateRecurring(ctx context.Context, actor uuid.UUID, in CreateRecurringInput) (*store.RecurringAgreement, error) {
	freq, interval, err := normalizeFrequency(in.Frequency, in.IntervalWeeks)
	if err != nil {
		return nil, err
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
		PickupBranchID: in.PickupBranchID, Frequency: freq, IntervalWeeks: interval, PreferredWeekday: in.PreferredWeekday,
		WindowStartMinute: in.WindowStart, WindowEndMinute: in.WindowEnd,
		StartDate: in.StartDate.UTC(), EndDate: in.EndDate, Status: "pending", HorizonDays: horizon,
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
	Origin           string   `json:"origin,omitempty"`
	PreviousStatus   string   `json:"previous_status,omitempty"`
	Frequency        string   `json:"frequency,omitempty"`
	IntervalWeeks    *int     `json:"interval_weeks,omitempty"`
	StartDate        string   `json:"start_date,omitempty"`
	EndDate          *string  `json:"end_date,omitempty"`
	PreferredWeekday *int     `json:"preferred_weekday,omitempty"`
	WindowStart      *int     `json:"window_start_minute,omitempty"`
	WindowEnd        *int     `json:"window_end_minute,omitempty"`
	Qty              *float64 `json:"qty,omitempty"`
	Reason           string   `json:"reason,omitempty"`
}

func (s *Service) ProposeRecurring(ctx context.Context, actor, id uuid.UUID, p RecurringProposal) (*store.RecurringAgreement, error) {
	a, err := s.store.GetRecurring(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("agreement not found")
	}
	origin := strings.ToLower(strings.TrimSpace(p.Origin))
	if origin == "buyer" {
		if err := s.requireMembership(ctx, a.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
			return nil, err
		}
		if a.Status != "active" && a.Status != "paused" {
			return nil, apperr.Validation("only active or paused agreements can be revised")
		}
	} else {
		origin = "supplier"
		if err := s.requireMembership(ctx, a.SupplierOrgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
	}
	p.Origin = origin
	p.PreviousStatus = a.Status
	if p.Frequency != "" {
		freq, interval, err := normalizeFrequency(p.Frequency, ptrInt(p.IntervalWeeks))
		if err != nil {
			return nil, err
		}
		p.Frequency = freq
		p.IntervalWeeks = &interval
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

func ptrInt(v *int) int {
	if v == nil {
		return 1
	}
	return *v
}

func (s *Service) RespondRecurringProposal(ctx context.Context, actor, id uuid.UUID, accept bool) (*store.RecurringAgreement, error) {
	a, err := s.store.GetRecurring(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("agreement not found")
	}
	var p RecurringProposal
	if len(a.ProposedChange) > 0 {
		_ = json.Unmarshal(a.ProposedChange, &p)
	}
	if strings.EqualFold(p.Origin, "buyer") {
		if err := s.requireMembership(ctx, a.SupplierOrgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
	} else if err := s.requireMembership(ctx, a.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	if !accept {
		restore := strings.TrimSpace(p.PreviousStatus)
		if restore == "" || restore == "pending_reconfirm" {
			restore = "pending"
		}
		if err := s.store.UpdateRecurringProposal(ctx, id, restore, []byte("{}"), now); err != nil {
			return nil, apperr.Internal(err)
		}
		a.Status = restore
		a.ProposedChange = []byte("{}")
		return a, nil
	}
	apply := store.RecurringApply{Frequency: p.Frequency, IntervalWeeks: p.IntervalWeeks, Qty: p.Qty, Weekday: p.PreferredWeekday, WindowStart: p.WindowStart, WindowEnd: p.WindowEnd}
	if p.StartDate != "" {
		if t, err := time.Parse("2006-01-02", p.StartDate); err == nil {
			apply.Start = &t
		}
	}
	if p.EndDate != nil && *p.EndDate != "" {
		if t, err := time.Parse("2006-01-02", *p.EndDate); err == nil {
			apply.End = &t
		}
	}
	if err := s.store.ApplyRecurringProposal(ctx, id, apply, now); err != nil {
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
	if a.EndDate != nil && a.EndDate.Before(until) {
		until = *a.EndDate
	}
	dates := recurringDates(a.StartDate, a.Frequency, a.IntervalWeeks, a.PreferredWeekday, until)
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
		if a.WindowStartMinute != nil {
			desired = day.Add(time.Duration(*a.WindowStartMinute) * time.Minute)
		}
		order, _, err := s.CreateSupplierOrder(ctx, a.CreatedBy, CreateOrderInput{
			BuyerOrgID: a.BuyerOrgID, SupplierOrgID: a.SupplierOrgID, LocationID: locs[0].ID,
			DestinationBranchID: a.PickupBranchID, PaymentMethod: "invoice",
			IdempotencyKey: "recurring:" + a.ID.String() + ":" + day.Format("2006-01-02"),
			Comment:        "Регулярная поставка", DesiredAt: &desired, Items: items,
		})
		if err != nil {
			_ = s.store.InsertRecurringException(ctx, ids.New(), a.ID, "product_unavailable", err.Error(), nil, s.now().UTC())
			continue
		}
		if err := s.store.InsertGeneratedOccurrence(ctx, a.ID, day, order.ID, s.now().UTC()); err != nil {
			return apperr.Internal(err)
		}
	}
	return nil
}

func recurringDates(start time.Time, freq string, intervalWeeks int, weekday *int, until time.Time) []time.Time {
	d := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	if weekday != nil {
		want := time.Weekday(*weekday)
		for d.Weekday() != want {
			d = d.AddDate(0, 0, 1)
		}
	}
	stepDays := 7
	switch freq {
	case "biweekly":
		stepDays = 14
	case "every_n_weeks":
		n := intervalWeeks
		if n < 1 {
			n = 1
		}
		stepDays = 7 * n
	case "monthly":
		stepDays = 0
	}
	var out []time.Time
	for !d.After(until) {
		out = append(out, d)
		if freq == "monthly" {
			d = d.AddDate(0, 1, 0)
		} else {
			d = d.AddDate(0, 0, stepDays)
		}
		if len(out) > 20 {
			break
		}
	}
	return out
}
