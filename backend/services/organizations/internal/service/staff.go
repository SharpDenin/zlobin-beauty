package service

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/geo"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
	"github.com/zlobin/zlobin-beauty/backend/shared/routing"
)

func (s *Service) ListOrgMembersInternal(ctx context.Context, orgID uuid.UUID, role string) ([]domain.Membership, error) {
	if _, err := s.GetOrg(ctx, orgID); err != nil {
		return nil, err
	}
	items, err := s.store.ListMembershipsByOrg(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	role = strings.TrimSpace(role)
	out := make([]domain.Membership, 0, len(items))
	for _, m := range items {
		if m.Status != "active" {
			continue
		}
		if role != "" && m.Role != role {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Service) ListStaff(ctx context.Context, orgID, actor uuid.UUID) ([]domain.Membership, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListMembershipsByOrg(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Membership{}
	}
	return items, nil
}

func (s *Service) InviteStaff(ctx context.Context, orgID, actor, userID uuid.UUID, role string) error {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return err
	}
	role = strings.TrimSpace(role)
	switch role {
	case "owner", "admin", "master", "staff", "rep":
	default:
		return apperr.Validation("invalid membership role")
	}
	now := s.now().UTC()
	if err := s.store.UpsertMembership(ctx, domain.Membership{
		ID: ids.New(), OrganizationID: orgID, UserID: userID, Role: role, Status: "active", CreatedAt: now,
	}); err != nil {
		return apperr.Internal(err)
	}
	meta, _ := json.Marshal(map[string]any{"role": role, "user_id": userID.String()})
	_ = s.store.AddOrgAudit(ctx, ids.New(), orgID, &actor, "membership.invited", "membership", &userID, meta, now)
	return nil
}

func (s *Service) DisableStaff(ctx context.Context, orgID, actor, userID uuid.UUID, role string) error {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return err
	}
	if userID == actor && role == "owner" {
		return apperr.Validation("cannot disable your own owner membership")
	}
	if err := s.store.SetMembershipStatus(ctx, orgID, userID, role, "removed"); err != nil {
		return apperr.NotFound("membership not found")
	}
	meta, _ := json.Marshal(map[string]any{"role": role, "user_id": userID.String()})
	_ = s.store.AddOrgAudit(ctx, ids.New(), orgID, &actor, "membership.disabled", "membership", &userID, meta, s.now().UTC())
	return nil
}

func (s *Service) SetContactPolicy(ctx context.Context, orgID, actor uuid.UUID, see bool) (*domain.Organization, error) {
	if err := s.requireOwner(ctx, orgID, actor); err != nil {
		return nil, err
	}
	org, err := s.GetOrg(ctx, orgID)
	if err != nil {
		return nil, err
	}
	org.MastersSeeClientContacts = see
	org.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateOrg(ctx, *org); err != nil {
		return nil, apperr.Internal(err)
	}
	meta, _ := json.Marshal(map[string]any{"masters_see_client_contacts": see})
	_ = s.store.AddOrgAudit(ctx, ids.New(), orgID, &actor, "contact_policy.updated", "organization", &orgID, meta, org.UpdatedAt)
	return org, nil
}

func (s *Service) ContactPolicy(ctx context.Context, orgID uuid.UUID) (bool, error) {
	org, err := s.GetOrg(ctx, orgID)
	if err != nil {
		return false, err
	}
	return org.MastersSeeClientContacts, nil
}

func (s *Service) CreateRepresentative(ctx context.Context, actor, orgID, userID uuid.UUID, city, territory, displayName, email string, salonIDs []uuid.UUID) (*domain.SupplierRepresentative, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return nil, err
	}
	org, err := s.GetOrg(ctx, orgID)
	if err != nil {
		return nil, err
	}
	if org.Type != "supplier" {
		return nil, apperr.Validation("representatives belong to a supplier")
	}
	city = strings.TrimSpace(city)
	if city == "" {
		return nil, apperr.Validation("city is required")
	}
	now := s.now().UTC()
	existing, err := s.store.GetRepresentativeByUser(ctx, orgID, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	rep := domain.SupplierRepresentative{
		ID: ids.New(), OrganizationID: orgID, UserID: userID, City: city, Territory: strings.TrimSpace(territory),
		DisplayName: strings.TrimSpace(displayName), Email: strings.ToLower(strings.TrimSpace(email)),
		Active: true, SalonBranchIDs: salonIDs, CreatedAt: now, UpdatedAt: now,
	}
	if existing != nil {
		rep.ID = existing.ID
		rep.CreatedAt = existing.CreatedAt
		if rep.DisplayName == "" {
			rep.DisplayName = existing.DisplayName
		}
		if rep.Email == "" {
			rep.Email = existing.Email
		}
	}
	if err := s.store.UpsertMembership(ctx, domain.Membership{
		ID: ids.New(), OrganizationID: orgID, UserID: userID, Role: "rep", Status: "active", CreatedAt: now,
	}); err != nil {
		return nil, apperr.Internal(err)
	}
	if err := s.store.UpsertRepresentative(ctx, rep); err != nil {
		return nil, apperr.Internal(err)
	}
	meta, _ := json.Marshal(map[string]any{"user_id": userID.String(), "city": city})
	_ = s.store.AddOrgAudit(ctx, ids.New(), orgID, &actor, "representative.assigned", "representative", &rep.ID, meta, now)
	return s.store.GetRepresentative(ctx, rep.ID)
}

func (s *Service) ListRepresentatives(ctx context.Context, actor, orgID uuid.UUID) ([]domain.SupplierRepresentative, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListRepresentatives(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.SupplierRepresentative{}
	}
	return items, nil
}

func (s *Service) GetRepresentative(ctx context.Context, actor, orgID, id uuid.UUID) (*domain.SupplierRepresentative, error) {
	rep, err := s.store.GetRepresentative(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if rep == nil || rep.OrganizationID != orgID {
		return nil, apperr.NotFound("representative not found")
	}
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		own, _ := s.store.GetRepresentativeByUser(ctx, orgID, actor)
		if own == nil || own.ID != id {
			return nil, err
		}
	}
	return rep, nil
}

func (s *Service) MyRepresentative(ctx context.Context, actor uuid.UUID) (*domain.SupplierRepresentative, error) {
	rep, err := s.store.GetRepresentativeByUserAny(ctx, actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if rep == nil {
		return nil, apperr.NotFound("representative profile not found")
	}
	return rep, nil
}

func NormalizeTaskKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "salon_visit", "delivery_support", "payment_collection", "commercial_visit", "other":
		return strings.TrimSpace(kind)
	default:
		return "other"
	}
}

func PlannerCategoryForKind(kind string) string {
	switch NormalizeTaskKind(kind) {
	case "salon_visit", "commercial_visit":
		return "salon_visit"
	case "delivery_support":
		return "delivery"
	default:
		return "task"
	}
}

func (s *Service) CreateTask(ctx context.Context, actor, orgID, repID uuid.UUID, title, description, kind, expectedResult string, branchID *uuid.UUID, dueAt *time.Time, priority string) (*domain.RepresentativeTask, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, apperr.Validation("title is required")
	}
	rep, err := s.store.GetRepresentative(ctx, repID)
	if err != nil || rep == nil || rep.OrganizationID != orgID {
		return nil, apperr.NotFound("representative not found")
	}
	if branchID != nil {
		b, err := s.store.GetBranch(ctx, *branchID)
		if err != nil || b == nil {
			return nil, apperr.Validation("salon not found")
		}
		if strings.TrimSpace(b.City) != "" && strings.TrimSpace(rep.City) != "" && !strings.EqualFold(b.City, rep.City) {
			return nil, apperr.Validation("cannot assign a salon from another city by default")
		}
	}
	if priority == "" {
		priority = "normal"
	}
	now := s.now().UTC()
	t := domain.RepresentativeTask{
		ID: ids.New(), OrganizationID: orgID, RepresentativeID: repID, BranchID: branchID,
		Title: title, Description: strings.TrimSpace(description), Kind: NormalizeTaskKind(kind),
		ExpectedResult: strings.TrimSpace(expectedResult), DueAt: dueAt, Priority: priority,
		Status: "open", CreatedBy: actor, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateTask(ctx, t); err != nil {
		return nil, apperr.Internal(err)
	}
	return &t, nil
}

func (s *Service) ListTasks(ctx context.Context, actor, orgID uuid.UUID, repID *uuid.UUID) ([]domain.RepresentativeTask, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		own, _ := s.store.GetRepresentativeByUser(ctx, orgID, actor)
		if own == nil {
			return nil, err
		}
		id := own.ID
		repID = &id
	}
	items, err := s.store.ListTasks(ctx, orgID, repID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	for i := range items {
		if items[i].Status == "open" && items[i].DueAt != nil && items[i].DueAt.Before(now) {
			items[i].Status = "overdue"
		}
	}
	if items == nil {
		items = []domain.RepresentativeTask{}
	}
	return items, nil
}

func (s *Service) UpdateTaskStatus(ctx context.Context, actor, taskID uuid.UUID, status, comment string) (*domain.RepresentativeTask, error) {
	t, err := s.store.GetTask(ctx, taskID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if t == nil {
		return nil, apperr.NotFound("task not found")
	}
	isOwner := s.requireOwnerAdmin(ctx, t.OrganizationID, actor) == nil
	rep, _ := s.store.GetRepresentativeByUser(ctx, t.OrganizationID, actor)
	isRep := rep != nil && rep.ID == t.RepresentativeID
	if !isOwner && !isRep {
		return nil, apperr.Forbidden("not allowed")
	}
	status = strings.TrimSpace(status)
	if isRep && !isOwner {
		switch status {
		case "in_progress", "done":
		default:
			return nil, apperr.Forbidden("representative can only start or complete a task")
		}
	} else {
		switch status {
		case "open", "in_progress", "done", "cancelled":
		default:
			return nil, apperr.Validation("invalid status")
		}
	}
	t.Status = status
	if c := strings.TrimSpace(comment); c != "" {
		t.ResultComment = c
	}
	t.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateTask(ctx, *t); err != nil {
		return nil, apperr.Internal(err)
	}
	return t, nil
}

func (s *Service) RecommendRoute(ctx context.Context, actor, orgID, repID uuid.UUID, date time.Time, originLat, originLng float64, stops []domain.FieldRouteStop) (*domain.FieldRoute, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		own, _ := s.store.GetRepresentativeByUser(ctx, orgID, actor)
		if own == nil || own.ID != repID {
			return nil, err
		}
	}
	rep, err := s.store.GetRepresentative(ctx, repID)
	if err != nil || rep == nil || rep.OrganizationID != orgID {
		return nil, apperr.NotFound("representative not found")
	}
	rStops := make([]routing.Stop, 0, len(stops))
	for i, st := range stops {
		lat, lng := 0.0, 0.0
		if st.Latitude != nil {
			lat = *st.Latitude
		}
		if st.Longitude != nil {
			lng = *st.Longitude
		}
		if st.BranchID != nil && (lat == 0 && lng == 0) {
			b, _ := s.store.GetBranch(ctx, *st.BranchID)
			if b != nil && b.Latitude != nil && b.Longitude != nil {
				lat, lng = *b.Latitude, *b.Longitude
				stops[i].Latitude, stops[i].Longitude = b.Latitude, b.Longitude
			}
			if b != nil && strings.TrimSpace(rep.City) != "" && !strings.EqualFold(b.City, rep.City) {
				return nil, apperr.Validation("stop city does not match representative territory")
			}
		}
		rStops = append(rStops, routing.Stop{
			ID: strconv.Itoa(i), Latitude: lat, Longitude: lng, Deadline: st.DeadlineAt,
			Duration: time.Duration(st.ExpectedDurationMin) * time.Minute,
		})
	}
	plan, err := routing.FromEnv().Plan(ctx, originLat, originLng, rStops)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	ordered := make([]domain.FieldRouteStop, 0, len(plan.Order))
	now := s.now().UTC()
	for i, idx := range plan.Order {
		st := stops[idx]
		st.ID = ids.New()
		st.SortOrder = i
		st.Status = "pending"
		st.CreatedAt = now
		if i < len(plan.Legs) {
			st.KmFromPrev = plan.Legs[i].Km
		}
		ordered = append(ordered, st)
	}
	rt := domain.FieldRoute{
		ID: ids.New(), OrganizationID: orgID, RepresentativeID: repID, PlannedDate: date,
		Status: "recommended", TotalKm: plan.TotalKm, TotalMinutes: plan.TotalMin, Provider: plan.Provider,
		Stops: ordered, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateRoute(ctx, rt); err != nil {
		return nil, apperr.Internal(err)
	}
	return s.store.GetRoute(ctx, rt.ID)
}

func (s *Service) ListRoutes(ctx context.Context, actor, orgID uuid.UUID, repID *uuid.UUID) ([]domain.FieldRoute, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		own, _ := s.store.GetRepresentativeByUser(ctx, orgID, actor)
		if own == nil {
			return nil, err
		}
		id := own.ID
		repID = &id
	}
	items, err := s.store.ListRoutes(ctx, orgID, repID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.FieldRoute{}
	}
	return items, nil
}

func (s *Service) ListRepTaskStats(ctx context.Context, actor, orgID uuid.UUID) ([]domain.RepTaskStats, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListRepTaskStats(ctx, orgID, s.now().UTC())
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.RepTaskStats{}
	}
	return items, nil
}

func (s *Service) UpdateStopStatus(ctx context.Context, actor, orgID, stopID uuid.UUID, status string) (*domain.FieldRouteStop, error) {
	st, rt, err := s.store.GetStopWithRoute(ctx, stopID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if st == nil || rt == nil || rt.OrganizationID != orgID {
		return nil, apperr.NotFound("stop not found")
	}
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		own, _ := s.store.GetRepresentativeByUser(ctx, orgID, actor)
		if own == nil || own.ID != rt.RepresentativeID {
			return nil, err
		}
	}
	switch strings.TrimSpace(status) {
	case "pending", "en_route", "arrived", "done", "skipped", "failed":
	default:
		return nil, apperr.Validation("invalid stop status")
	}
	if err := s.store.UpdateStopStatus(ctx, stopID, status); err != nil {
		return nil, apperr.Internal(err)
	}
	st.Status = status
	return st, nil
}

func (s *Service) PickupNearest(ctx context.Context, city string, lat, lng *float64) ([]map[string]any, error) {
	items, err := s.ListPickupBranches(ctx, city)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(items))
	for _, b := range items {
		var dist any
		if lat != nil && lng != nil && b.Latitude != nil && b.Longitude != nil {
			d := geo.DistanceKm(*lat, *lng, *b.Latitude, *b.Longitude)
			dist = d
		}
		m := map[string]any{
			"id": b.ID.String(), "name": b.Name, "city": b.City, "address_line": b.AddressLine,
			"timezone": b.Timezone, "pickup_enabled": b.PickupEnabled, "distance_km": dist,
			"latitude": b.Latitude, "longitude": b.Longitude,
		}
		out = append(out, m)
	}
	if lat != nil && lng != nil {
		for i := 0; i < len(out); i++ {
			for j := i + 1; j < len(out); j++ {
				di, _ := out[i]["distance_km"].(float64)
				dj, _ := out[j]["distance_km"].(float64)
				if out[j]["distance_km"] != nil && (out[i]["distance_km"] == nil || dj < di) {
					out[i], out[j] = out[j], out[i]
				}
			}
		}
	}
	return out, nil
}
