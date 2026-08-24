package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

const (
	chairBusyUserMsg  = "Это кресло уже занято в выбранный период"
	leaseOverlapUserMsg = "Это кресло уже сдано в аренду на пересекающийся период"
)

type WorkModeIntervalInput struct {
	Mode           string
	StartsAt       time.Time
	EndsAt         time.Time
	Timezone       string
	OrganizationID *uuid.UUID
	BranchID       *uuid.UUID
	ChairID        *uuid.UUID
	PercentageRate *float64
	CityID         *uuid.UUID
	DistrictIDs    []uuid.UUID
}

type OnsiteMatch struct {
	MasterUserID uuid.UUID
	StartsAt     time.Time
	EndsAt       time.Time
	Timezone     string
	City         string
	Districts    []string
	IntervalID   uuid.UUID
}

func coveringWorkMode(items []domain.WorkModeInterval, start, end time.Time) *domain.WorkModeInterval {
	for i := range items {
		it := &items[i]
		if !it.StartsAt.After(start) && !it.EndsAt.Before(end) {
			return it
		}
	}
	return nil
}

func districtInInterval(in domain.WorkModeInterval, districtID uuid.UUID) bool {
	for _, d := range in.Districts {
		if d.ID == districtID {
			return true
		}
	}
	return false
}

func isForbidden(err error) bool {
	ae, ok := apperr.As(err)
	return ok && ae.Code == apperr.CodeForbidden
}

func (s *Service) ListGeoCities(ctx context.Context) ([]domain.GeoCity, error) {
	items, err := s.store.ListGeoCities(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) ListGeoDistricts(ctx context.Context, cityID uuid.UUID) ([]domain.GeoDistrict, error) {
	city, err := s.store.GetGeoCity(ctx, cityID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if city == nil {
		return nil, apperr.NotFound("city not found")
	}
	items, err := s.store.ListGeoDistricts(ctx, cityID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) ListMyWorkModeIntervals(ctx context.Context, masterUserID uuid.UUID, from, to time.Time) ([]domain.WorkModeInterval, error) {
	if !to.After(from) {
		return nil, apperr.Validation("to must be after from")
	}
	items, err := s.store.ListWorkModeIntervals(ctx, masterUserID, from, to)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) CalendarWorkModeIntervals(ctx context.Context, actor, orgID, masterUserID uuid.UUID, from, to time.Time) ([]domain.WorkModeInterval, error) {
	if !to.After(from) {
		return nil, apperr.Validation("to must be after from")
	}
	target := masterUserID
	if target == uuid.Nil {
		target = actor
	}
	if target != actor {
		if orgID == uuid.Nil {
			return nil, apperr.Forbidden("cannot view another master's work modes")
		}
		if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
	}
	items, err := s.store.ListWorkModeIntervals(ctx, target, from, to)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) CreateWorkModeInterval(ctx context.Context, actor uuid.UUID, in WorkModeIntervalInput) (*domain.WorkModeInterval, error) {
	mode := strings.TrimSpace(in.Mode)
	if !domain.ValidWorkMode(mode) {
		return nil, apperr.Validation("mode must be percentage, chair or onsite")
	}
	start, end := in.StartsAt.UTC(), in.EndsAt.UTC()
	if !end.After(start) {
		return nil, apperr.Validation("ends_at must be after starts_at")
	}
	tz := strings.TrimSpace(in.Timezone)
	now := s.now().UTC()
	item := domain.WorkModeInterval{
		ID: ids.New(), MasterUserID: actor, Mode: mode, StartsAt: start, EndsAt: end,
		CreatedAt: now, UpdatedAt: now,
	}
	var districtIDs []uuid.UUID

	switch mode {
	case domain.WorkModePercentage:
		if in.OrganizationID == nil || *in.OrganizationID == uuid.Nil {
			return nil, apperr.Validation("organization_id is required for percentage mode")
		}
		if err := s.requireMembership(ctx, *in.OrganizationID, actor, "owner", "admin", "master", "staff"); err != nil {
			return nil, err
		}
		if in.PercentageRate == nil || *in.PercentageRate <= 0 || *in.PercentageRate > 100 {
			return nil, apperr.Validation("percentage_rate must be between 0 and 100")
		}
		item.OrganizationID = in.OrganizationID
		item.BranchID = in.BranchID
		item.PercentageRate = in.PercentageRate
		if tz == "" && in.BranchID != nil {
			tz = s.timezoneForBranch(ctx, *in.BranchID)
		}
	case domain.WorkModeChair:
		if in.ChairID == nil || *in.ChairID == uuid.Nil {
			return nil, apperr.Validation("chair_id is required for chair mode")
		}
		if err := s.assertCanUseChair(ctx, actor, *in.ChairID, start, end); err != nil {
			return nil, err
		}
		chair, err := s.store.GetChair(ctx, *in.ChairID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		item.ChairID = in.ChairID
		item.OrganizationID = &chair.OrganizationID
		item.BranchID = &chair.BranchID
		busy, err := s.store.ChairIntervalOverlap(ctx, chair.ID, start, end, uuid.Nil)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if busy {
			return nil, apperr.Conflict(chairBusyUserMsg)
		}
		if tz == "" {
			tz = s.timezoneForBranch(ctx, chair.BranchID)
		}
	case domain.WorkModeOnsite:
		if in.CityID == nil || *in.CityID == uuid.Nil {
			return nil, apperr.Validation("city_id is required for onsite mode")
		}
		city, err := s.store.GetGeoCity(ctx, *in.CityID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if city == nil {
			return nil, apperr.Validation("city not found")
		}
		if len(in.DistrictIDs) == 0 {
			return nil, apperr.Validation("at least one district is required for onsite mode")
		}
		seen := map[uuid.UUID]struct{}{}
		for _, id := range in.DistrictIDs {
			if _, ok := seen[id]; ok {
				continue
			}
			d, err := s.store.GetGeoDistrict(ctx, id)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			if d == nil {
				return nil, apperr.Validation("district not found")
			}
			if d.CityID != city.ID {
				return nil, apperr.Validation("районы одного интервала должны относиться к одному городу")
			}
			seen[id] = struct{}{}
			districtIDs = append(districtIDs, id)
		}
		item.CityID = &city.ID
		if tz == "" {
			tz = city.Timezone
		}
	}
	if tz == "" {
		tz = defaultTimezone
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return nil, apperr.Validation("invalid timezone")
	}
	item.Timezone = tz
	if err := s.store.CreateWorkModeInterval(ctx, item, districtIDs); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	out, err := s.store.GetWorkModeInterval(ctx, item.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return out, nil
}

func (s *Service) DeleteWorkModeInterval(ctx context.Context, actor, id uuid.UUID) error {
	if err := s.store.DeleteWorkModeInterval(ctx, id, actor); err != nil {
		if ae, ok := apperr.As(err); ok {
			return ae
		}
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) CreateChair(ctx context.Context, actor, orgID, branchID uuid.UUID, name, description string, listed bool, rentNote string) (*domain.SalonChair, error) {
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, apperr.Validation("name is required")
	}
	now := s.now().UTC()
	c := domain.SalonChair{
		ID: ids.New(), OrganizationID: orgID, BranchID: branchID, Name: name,
		Description: strings.TrimSpace(description), Status: domain.ChairStatusActive,
		ListedForRent: listed, RentNote: strings.TrimSpace(rentNote), CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateChair(ctx, c); err != nil {
		return nil, apperr.Internal(err)
	}
	return &c, nil
}

func (s *Service) UpdateChair(ctx context.Context, actor, chairID uuid.UUID, name, description, status *string, listed *bool, rentNote *string) (*domain.SalonChair, error) {
	c, err := s.store.GetChair(ctx, chairID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if c == nil {
		return nil, apperr.NotFound("chair not found")
	}
	if err := s.requireMembership(ctx, c.OrganizationID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	if name != nil {
		n := strings.TrimSpace(*name)
		if n == "" {
			return nil, apperr.Validation("name is required")
		}
		c.Name = n
	}
	if description != nil {
		c.Description = strings.TrimSpace(*description)
	}
	if status != nil {
		st := strings.TrimSpace(*status)
		if st != domain.ChairStatusActive && st != domain.ChairStatusInactive {
			return nil, apperr.Validation("status must be active or inactive")
		}
		c.Status = st
	}
	if listed != nil {
		c.ListedForRent = *listed
	}
	if rentNote != nil {
		c.RentNote = strings.TrimSpace(*rentNote)
	}
	c.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateChair(ctx, *c); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return c, nil
}

func (s *Service) ListOrgChairs(ctx context.Context, actor, orgID uuid.UUID) ([]domain.SalonChair, error) {
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master", "staff"); err != nil {
		return nil, err
	}
	items, err := s.store.ListOrgChairs(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) ListMarketplaceChairs(ctx context.Context) ([]domain.SalonChair, error) {
	_ = s.store.ExpireLeases(ctx, s.now().UTC())
	items, err := s.store.ListMarketplaceChairs(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) ListUsableChairs(ctx context.Context, actor, orgID uuid.UUID) ([]domain.SalonChair, error) {
	_ = s.store.ExpireLeases(ctx, s.now().UTC())
	seen := map[uuid.UUID]struct{}{}
	var out []domain.SalonChair
	if orgID != uuid.Nil {
		err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master", "staff")
		if err == nil {
			items, err := s.store.ListOrgChairs(ctx, orgID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			for _, c := range items {
				if c.Status != domain.ChairStatusActive {
					continue
				}
				seen[c.ID] = struct{}{}
				out = append(out, c)
			}
		} else if !isForbidden(err) {
			return nil, err
		}
	}
	leases, err := s.store.ListLeasesForRenter(ctx, actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	var chairIDs []uuid.UUID
	for _, l := range leases {
		if l.Status == domain.LeaseActive && l.EndsAt.After(now) {
			if _, ok := seen[l.ChairID]; !ok {
				chairIDs = append(chairIDs, l.ChairID)
			}
		}
	}
	if len(chairIDs) > 0 {
		chairs, err := s.store.ListChairsByIDs(ctx, chairIDs)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		for _, c := range chairs {
			if c.Status != domain.ChairStatusActive {
				continue
			}
			if _, ok := seen[c.ID]; ok {
				continue
			}
			seen[c.ID] = struct{}{}
			out = append(out, c)
		}
	}
	if out == nil {
		out = []domain.SalonChair{}
	}
	return out, nil
}

func (s *Service) RequestChairLease(ctx context.Context, actor, chairID uuid.UUID, start, end time.Time) (*domain.ChairLease, error) {
	_ = s.store.ExpireLeases(ctx, s.now().UTC())
	start, end = start.UTC(), end.UTC()
	if !end.After(start) {
		return nil, apperr.Validation("ends_at must be after starts_at")
	}
	chair, err := s.store.GetChair(ctx, chairID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if chair == nil || chair.Status != domain.ChairStatusActive || !chair.ListedForRent {
		return nil, apperr.NotFound("chair is not available for rent")
	}
	if err := s.requireMembership(ctx, chair.OrganizationID, actor, "owner", "admin", "master", "staff"); err == nil {
		return nil, apperr.Validation("сотрудник салона не арендует кресло своей организации")
	} else if !isForbidden(err) {
		return nil, err
	}
	overlap, err := s.store.HasActiveLeaseOverlap(ctx, chairID, start, end, uuid.Nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if overlap {
		return nil, apperr.Conflict(leaseOverlapUserMsg)
	}
	now := s.now().UTC()
	l := domain.ChairLease{
		ID: ids.New(), ChairID: chairID, OrganizationID: chair.OrganizationID, RenterUserID: actor,
		StartsAt: start, EndsAt: end, Status: domain.LeaseRequested, CreatedAt: now, UpdatedAt: now, Chair: chair,
	}
	if err := s.store.CreateLease(ctx, l); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return &l, nil
}

func (s *Service) ApproveChairLease(ctx context.Context, actor, leaseID uuid.UUID) (*domain.ChairLease, error) {
	return s.transitionLease(ctx, actor, leaseID, domain.LeaseActive, true)
}

func (s *Service) RejectChairLease(ctx context.Context, actor, leaseID uuid.UUID) (*domain.ChairLease, error) {
	return s.transitionLease(ctx, actor, leaseID, domain.LeaseRejected, true)
}

func (s *Service) CancelChairLease(ctx context.Context, actor, leaseID uuid.UUID) (*domain.ChairLease, error) {
	l, err := s.store.GetLease(ctx, leaseID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if l == nil {
		return nil, apperr.NotFound("lease not found")
	}
	if l.RenterUserID == actor {
		if l.Status != domain.LeaseRequested && l.Status != domain.LeaseActive {
			return nil, apperr.Conflict("lease cannot be cancelled")
		}
		if err := s.store.UpdateLeaseStatus(ctx, leaseID, domain.LeaseCancelled, s.now().UTC()); err != nil {
			if ae, ok := apperr.As(err); ok {
				return nil, ae
			}
			return nil, apperr.Internal(err)
		}
		l.Status = domain.LeaseCancelled
		return l, nil
	}
	return s.transitionLease(ctx, actor, leaseID, domain.LeaseCancelled, true)
}

func (s *Service) transitionLease(ctx context.Context, actor, leaseID uuid.UUID, status string, requireOwner bool) (*domain.ChairLease, error) {
	_ = s.store.ExpireLeases(ctx, s.now().UTC())
	l, err := s.store.GetLease(ctx, leaseID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if l == nil {
		return nil, apperr.NotFound("lease not found")
	}
	if requireOwner {
		if err := s.requireMembership(ctx, l.OrganizationID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
	}
	if status == domain.LeaseActive {
		if l.Status != domain.LeaseRequested {
			return nil, apperr.Conflict("only a requested lease can be approved")
		}
		overlap, err := s.store.HasActiveLeaseOverlap(ctx, l.ChairID, l.StartsAt, l.EndsAt, l.ID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if overlap {
			return nil, apperr.Conflict(leaseOverlapUserMsg)
		}
	}
	if err := s.store.UpdateLeaseStatus(ctx, leaseID, status, s.now().UTC()); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	l.Status = status
	return l, nil
}

func (s *Service) ListMyLeases(ctx context.Context, actor uuid.UUID) ([]domain.ChairLease, error) {
	_ = s.store.ExpireLeases(ctx, s.now().UTC())
	items, err := s.store.ListLeasesForRenter(ctx, actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return s.withLeaseChairs(ctx, items)
}

func (s *Service) ListOrgLeases(ctx context.Context, actor, orgID uuid.UUID) ([]domain.ChairLease, error) {
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	_ = s.store.ExpireLeases(ctx, s.now().UTC())
	items, err := s.store.ListOrgLeases(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return s.withLeaseChairs(ctx, items)
}

func (s *Service) withLeaseChairs(ctx context.Context, items []domain.ChairLease) ([]domain.ChairLease, error) {
	idList := make([]uuid.UUID, 0, len(items))
	seen := map[uuid.UUID]struct{}{}
	for _, l := range items {
		if _, ok := seen[l.ChairID]; ok {
			continue
		}
		seen[l.ChairID] = struct{}{}
		idList = append(idList, l.ChairID)
	}
	chairs, err := s.store.ListChairsByIDs(ctx, idList)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	byID := map[uuid.UUID]domain.SalonChair{}
	for _, c := range chairs {
		byID[c.ID] = c
	}
	for i := range items {
		if c, ok := byID[items[i].ChairID]; ok {
			cp := c
			items[i].Chair = &cp
		}
	}
	return items, nil
}

func (s *Service) assertCanUseChair(ctx context.Context, userID, chairID uuid.UUID, start, end time.Time) error {
	_ = s.store.ExpireLeases(ctx, s.now().UTC())
	chair, err := s.store.GetChair(ctx, chairID)
	if err != nil {
		return apperr.Internal(err)
	}
	if chair == nil || chair.Status != domain.ChairStatusActive {
		return apperr.Forbidden("chair is not available")
	}
	err = s.requireMembership(ctx, chair.OrganizationID, userID, "owner", "admin", "master", "staff")
	if err == nil {
		return nil
	}
	if !isForbidden(err) {
		return err
	}
	lease, err := s.store.ActiveLeaseCovering(ctx, chairID, userID, start, end)
	if err != nil {
		return apperr.Internal(err)
	}
	if lease == nil {
		return apperr.Forbidden("нет права использовать это кресло в выбранный период")
	}
	return nil
}

func (s *Service) InternalOnsiteMatches(ctx context.Context, city string, districtID uuid.UUID, day time.Time, masterIDs []uuid.UUID) ([]OnsiteMatch, error) {
	city = strings.TrimSpace(city)
	if city == "" || districtID == uuid.Nil {
		return nil, apperr.Validation("city and district_id are required")
	}
	d, err := s.store.GetGeoDistrict(ctx, districtID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if d == nil {
		return nil, apperr.Validation("district not found")
	}
	cityRow, err := s.store.GetGeoCity(ctx, d.CityID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	tz := defaultTimezone
	if cityRow != nil && cityRow.Timezone != "" {
		tz = cityRow.Timezone
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	localDay := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
	from, to := localDay.UTC(), localDay.Add(24*time.Hour).UTC()
	items, err := s.store.ListOnsiteMatches(ctx, city, districtID, from, to)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	allow := map[uuid.UUID]struct{}{}
	for _, id := range masterIDs {
		allow[id] = struct{}{}
	}
	out := make([]OnsiteMatch, 0, len(items))
	for _, it := range items {
		if len(allow) > 0 {
			if _, ok := allow[it.MasterUserID]; !ok {
				continue
			}
		}
		names := make([]string, 0, len(it.Districts))
		for _, dist := range it.Districts {
			names = append(names, dist.Name)
		}
		cityName := city
		if it.City != nil {
			cityName = it.City.Name
		}
		out = append(out, OnsiteMatch{
			MasterUserID: it.MasterUserID, StartsAt: it.StartsAt, EndsAt: it.EndsAt,
			Timezone: it.Timezone, City: cityName, Districts: names, IntervalID: it.ID,
		})
	}
	return out, nil
}

func (s *Service) attachWorkModeSnapshot(ctx context.Context, a *domain.Appointment, districtID *uuid.UUID) error {
	tz := a.LocationTimezone
	if tz == "" {
		tz = defaultTimezone
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	local := a.StartsAt.In(loc)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	from, to := dayStart.UTC(), dayStart.Add(24*time.Hour).UTC()
	items, err := s.store.ListWorkModeIntervals(ctx, a.MasterUserID, from, to)
	if err != nil {
		return apperr.Internal(err)
	}
	if len(items) == 0 {
		return nil
	}
	cov := coveringWorkMode(items, a.StartsAt, a.EndsAt)
	if cov == nil {
		return apperr.Conflict("выбранное время не попадает в режим работы мастера")
	}
	a.WorkMode = cov.Mode
	id := cov.ID
	a.WorkModeIntervalID = &id
	switch cov.Mode {
	case domain.WorkModeChair:
		if cov.ChairID == nil {
			return apperr.Conflict("chair mode interval is missing chair")
		}
		if err := s.assertCanUseChair(ctx, a.MasterUserID, *cov.ChairID, a.StartsAt, a.EndsAt); err != nil {
			return err
		}
		a.ChairID = cov.ChairID
		if cov.Chair != nil {
			a.LocationName = cov.Chair.Name
		}
	case domain.WorkModeOnsite:
		a.OnsiteCityID = cov.CityID
		if cov.City != nil {
			a.LocationCity = cov.City.Name
			a.LocationTimezone = cov.Timezone
			a.LocationName = "Выезд"
		}
		if districtID != nil {
			if !districtInInterval(*cov, *districtID) {
				return apperr.Validation("район не входит в выездную доступность мастера")
			}
			a.OnsiteDistrictID = districtID
		}
		names := make([]string, 0, len(cov.Districts))
		for _, d := range cov.Districts {
			names = append(names, d.Name)
		}
		if len(names) > 0 {
			a.LocationAddress = strings.Join(names, ", ")
		}
	}
	return nil
}

func (s *Service) workModeForSlot(ctx context.Context, masterUserID uuid.UUID, st, en time.Time, loc *time.Location) (string, bool, error) {
	local := st.In(loc)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	from, to := dayStart.UTC(), dayStart.Add(24*time.Hour).UTC()
	items, err := s.store.ListWorkModeIntervals(ctx, masterUserID, from, to)
	if err != nil {
		return "", false, err
	}
	if len(items) == 0 {
		return "", true, nil
	}
	cov := coveringWorkMode(items, st, en)
	if cov == nil {
		return "", false, nil
	}
	return cov.Mode, true, nil
}
