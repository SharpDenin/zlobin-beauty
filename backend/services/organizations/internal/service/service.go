package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store *store.Store
	now   func() time.Time
}

func New(st *store.Store) *Service {
	return &Service{store: st, now: time.Now}
}

type CreateOrgInput struct {
	Name        string
	Type        string
	BranchName  string
	City        string
	AddressLine string
	Timezone    string
	CreatedBy   uuid.UUID
}

type OrgBundle struct {
	Organization domain.Organization
	Branch       domain.Branch
}

type UpdateOrgInput struct {
	ActorID      uuid.UUID
	OrgID        uuid.UUID
	Name         *string
	Description  *string
	Published    *bool
	DeliveryNote *string
	LogoMediaID  *uuid.UUID
	ClearLogo    bool
}

type UpdateBranchInput struct {
	ActorID          uuid.UUID
	BranchID         uuid.UUID
	Name             *string
	City             *string
	AddressLine      *string
	Phone            *string
	Timezone         *string
	Published        *bool
	PickupEnabled    *bool
	Latitude         *float64
	Longitude        *float64
	WorkingHoursNote *string
	PhotoMediaID     *uuid.UUID
	ClearPhotoMedia  bool
}

func (s *Service) Create(ctx context.Context, in CreateOrgInput) (*OrgBundle, error) {
	name := strings.TrimSpace(in.Name)
	branchName := strings.TrimSpace(in.BranchName)
	city := strings.TrimSpace(in.City)
	address := strings.TrimSpace(in.AddressLine)
	orgType := strings.TrimSpace(in.Type)
	if name == "" || branchName == "" || city == "" || address == "" {
		return nil, apperr.Validation("name, branch_name, city and address_line are required")
	}
	if orgType == "" {
		orgType = "salon"
	}
	if orgType != "salon" && orgType != "supplier" && orgType != "network" {
		return nil, apperr.Validation("invalid organization type")
	}
	tz := strings.TrimSpace(in.Timezone)
	if tz == "" {
		tz = "Europe/Moscow"
	}
	now := s.now().UTC()
	org := domain.Organization{
		ID: ids.New(), Name: name, Type: orgType, Status: "active",
		CreatedBy: in.CreatedBy, CreatedAt: now, UpdatedAt: now,
	}
	branch := domain.Branch{
		ID: ids.New(), OrganizationID: org.ID, Name: branchName, City: city, AddressLine: address,
		Timezone: tz, CancelWindowHours: 12, AutoConfirm: false, PickupEnabled: true, CreatedAt: now, UpdatedAt: now,
	}
	ownerRole := "owner"
	if orgType == "supplier" {
		ownerRole = "owner"
	}
	membership := domain.Membership{
		ID: ids.New(), OrganizationID: org.ID, UserID: in.CreatedBy, Role: ownerRole, Status: "active", CreatedAt: now,
	}
	if err := s.store.CreateOrgWithBranchAndOwner(ctx, org, branch, membership); err != nil {
		return nil, apperr.Internal(err)
	}
	return &OrgBundle{Organization: org, Branch: branch}, nil
}

func (s *Service) MyOrgs(ctx context.Context, userID uuid.UUID) ([]domain.Organization, map[uuid.UUID][]domain.Branch, map[uuid.UUID][]domain.Membership, error) {
	memberships, err := s.store.ListMembershipsByUser(ctx, userID)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	orgs := make([]domain.Organization, 0)
	branches := map[uuid.UUID][]domain.Branch{}
	byOrgMem := map[uuid.UUID][]domain.Membership{}
	seen := map[uuid.UUID]struct{}{}
	for _, m := range memberships {
		byOrgMem[m.OrganizationID] = append(byOrgMem[m.OrganizationID], m)
		if _, ok := seen[m.OrganizationID]; ok {
			continue
		}
		seen[m.OrganizationID] = struct{}{}
		org, err := s.store.GetOrg(ctx, m.OrganizationID)
		if err != nil {
			return nil, nil, nil, apperr.Internal(err)
		}
		if org == nil {
			continue
		}
		orgs = append(orgs, *org)
		bs, err := s.store.ListBranches(ctx, org.ID)
		if err != nil {
			return nil, nil, nil, apperr.Internal(err)
		}
		branches[org.ID] = bs
	}
	return orgs, branches, byOrgMem, nil
}

func (s *Service) AddMasterMembership(ctx context.Context, orgID, actorID, masterUserID uuid.UUID) error {
	ok, err := s.store.HasMembership(ctx, orgID, actorID, "owner", "admin")
	if err != nil {
		return apperr.Internal(err)
	}
	if !ok {
		return apperr.Forbidden("not allowed to manage memberships")
	}
	now := s.now().UTC()
	return apperrOrNil(s.store.UpsertMembership(ctx, domain.Membership{
		ID: ids.New(), OrganizationID: orgID, UserID: masterUserID, Role: "master", Status: "active", CreatedAt: now,
	}))
}

func (s *Service) GetOrg(ctx context.Context, id uuid.UUID) (*domain.Organization, error) {
	o, err := s.store.GetOrg(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, apperr.NotFound("organization not found")
	}
	return o, nil
}

func (s *Service) GetBranch(ctx context.Context, id uuid.UUID) (*domain.Branch, error) {
	b, err := s.store.GetBranch(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if b == nil {
		return nil, apperr.NotFound("branch not found")
	}
	return b, nil
}

func (s *Service) HasActiveMembership(ctx context.Context, orgID, userID uuid.UUID, roles ...string) (bool, error) {
	ok, err := s.store.HasMembership(ctx, orgID, userID, roles...)
	if err != nil {
		return false, apperr.Internal(err)
	}
	return ok, nil
}

func (s *Service) requireOwnerAdmin(ctx context.Context, orgID, actorID uuid.UUID) error {
	ok, err := s.store.HasMembership(ctx, orgID, actorID, "owner", "admin")
	if err != nil {
		return apperr.Internal(err)
	}
	if !ok {
		return apperr.Forbidden("not allowed")
	}
	return nil
}

func (s *Service) OrgReadiness(ctx context.Context, orgID, actorID uuid.UUID) (*domain.Readiness, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actorID); err != nil {
		return nil, err
	}
	org, err := s.store.GetOrg(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if org == nil {
		return nil, apperr.NotFound("organization not found")
	}
	branches, err := s.store.ListBranches(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return evaluateOrgReadiness(*org, branches), nil
}

func (s *Service) BranchReadiness(ctx context.Context, branchID, actorID uuid.UUID) (*domain.Readiness, error) {
	b, err := s.store.GetBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if b == nil {
		return nil, apperr.NotFound("branch not found")
	}
	if err := s.requireOwnerAdmin(ctx, b.OrganizationID, actorID); err != nil {
		return nil, err
	}
	return evaluateBranchReadiness(*b), nil
}

func (s *Service) UpdateOrg(ctx context.Context, in UpdateOrgInput) (*domain.Organization, error) {
	if err := s.requireOwnerAdmin(ctx, in.OrgID, in.ActorID); err != nil {
		return nil, err
	}
	org, err := s.store.GetOrg(ctx, in.OrgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if org == nil {
		return nil, apperr.NotFound("organization not found")
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return nil, apperr.Validation("name cannot be empty")
		}
		org.Name = name
	}
	if in.Description != nil {
		org.Description = strings.TrimSpace(*in.Description)
	}
	if in.DeliveryNote != nil {
		org.DeliveryNote = strings.TrimSpace(*in.DeliveryNote)
	}
	if in.ClearLogo {
		org.LogoMediaID = nil
	} else if in.LogoMediaID != nil {
		org.LogoMediaID = in.LogoMediaID
	}
	if in.Published != nil {
		if *in.Published {
			branches, err := s.store.ListBranches(ctx, org.ID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			ready := evaluateOrgReadiness(*org, branches)
			if !ready.Ready {
				return nil, apperr.Validation("organization is not ready for publication: " + strings.Join(ready.Missing, ", "))
			}
		}
		org.Published = *in.Published
	}
	org.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateOrg(ctx, *org); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.NotFound("organization not found")
		}
		return nil, apperr.Internal(err)
	}
	return org, nil
}

func (s *Service) ListSuppliers(ctx context.Context) ([]domain.SupplierListItem, error) {
	items, err := s.store.ListPublishedSuppliers(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.SupplierListItem{}
	}
	return items, nil
}

func (s *Service) GetSupplier(ctx context.Context, id uuid.UUID) (*domain.SupplierListItem, error) {
	item, err := s.store.GetPublishedSupplier(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if item == nil {
		return nil, apperr.NotFound("supplier not found")
	}
	return item, nil
}

func (s *Service) UpdateBranch(ctx context.Context, in UpdateBranchInput) (*domain.Branch, error) {
	b, err := s.store.GetBranch(ctx, in.BranchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if b == nil {
		return nil, apperr.NotFound("branch not found")
	}
	if err := s.requireOwnerAdmin(ctx, b.OrganizationID, in.ActorID); err != nil {
		return nil, err
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return nil, apperr.Validation("name cannot be empty")
		}
		b.Name = name
	}
	if in.City != nil {
		city := strings.TrimSpace(*in.City)
		if city == "" {
			return nil, apperr.Validation("city cannot be empty")
		}
		b.City = city
	}
	if in.AddressLine != nil {
		addr := strings.TrimSpace(*in.AddressLine)
		if addr == "" {
			return nil, apperr.Validation("address_line cannot be empty")
		}
		b.AddressLine = addr
	}
	if in.Phone != nil {
		b.Phone = strings.TrimSpace(*in.Phone)
	}
	if in.Timezone != nil {
		tz := strings.TrimSpace(*in.Timezone)
		if tz == "" {
			return nil, apperr.Validation("timezone cannot be empty")
		}
		b.Timezone = tz
	}
	if in.Published != nil {
		if *in.Published {
			ready := evaluateBranchReadiness(*b)
			if !ready.Ready {
				return nil, apperr.Validation("branch is not ready for publication: " + strings.Join(ready.Missing, ", "))
			}
		}
		b.Published = *in.Published
	}
	if in.PickupEnabled != nil {
		b.PickupEnabled = *in.PickupEnabled
	}
	if in.Latitude != nil {
		b.Latitude = in.Latitude
	}
	if in.Longitude != nil {
		b.Longitude = in.Longitude
	}
	if in.WorkingHoursNote != nil {
		b.WorkingHoursNote = strings.TrimSpace(*in.WorkingHoursNote)
	}
	if in.ClearPhotoMedia {
		b.PhotoMediaID = nil
	} else if in.PhotoMediaID != nil {
		b.PhotoMediaID = in.PhotoMediaID
	}
	b.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateBranch(ctx, *b); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.NotFound("branch not found")
		}
		return nil, apperr.Internal(err)
	}
	return b, nil
}

func (s *Service) ListPickupBranches(ctx context.Context, city string) ([]domain.Branch, error) {
	items, err := s.store.ListPickupBranches(ctx, strings.TrimSpace(city))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Branch{}
	}
	return items, nil
}

func evaluateBranchReadiness(b domain.Branch) *domain.Readiness {
	checks := []domain.ReadinessCheck{
		{Key: "branch_name", Label: "Название филиала", OK: nonEmpty(b.Name)},
		{Key: "branch_city", Label: "Город", OK: nonEmpty(b.City)},
		{Key: "branch_address", Label: "Адрес", OK: nonEmpty(b.AddressLine)},
		{Key: "branch_phone", Label: "Телефон", OK: nonEmpty(b.Phone)},
		{Key: "branch_timezone", Label: "Часовой пояс", OK: nonEmpty(b.Timezone)},
	}
	return finalizeReadiness(checks)
}

func evaluateOrgReadiness(org domain.Organization, branches []domain.Branch) *domain.Readiness {
	checks := []domain.ReadinessCheck{
		{Key: "org_name", Label: "Название салона", OK: nonEmpty(org.Name)},
		{Key: "org_branch", Label: "Хотя бы один филиал", OK: len(branches) > 0},
	}
	branchReady := false
	for _, b := range branches {
		br := evaluateBranchReadiness(b)
		if br.Ready {
			branchReady = true
			break
		}
	}
	checks = append(checks, domain.ReadinessCheck{
		Key: "branch_ready", Label: "Филиал с полным адресом и телефоном", OK: branchReady,
	})
	// Working hours live in booking (master schedule); branch publication checks address fields only.
	return finalizeReadiness(checks)
}

func finalizeReadiness(checks []domain.ReadinessCheck) *domain.Readiness {
	var missing []string
	for i := range checks {
		if !checks[i].OK {
			missing = append(missing, checks[i].Key)
			checks[i].Missing = checks[i].Label
		}
	}
	if missing == nil {
		missing = []string{}
	}
	return &domain.Readiness{Ready: len(missing) == 0, Missing: missing, Checks: checks}
}

func nonEmpty(s string) bool { return strings.TrimSpace(s) != "" }

func apperrOrNil(err error) error {
	if err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) ListBranchPhotos(ctx context.Context, branchID uuid.UUID) ([]domain.BranchPhoto, error) {
	b, err := s.store.GetBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if b == nil {
		return nil, apperr.NotFound("branch not found")
	}
	items, err := s.store.ListBranchPhotos(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.BranchPhoto{}
	}
	return items, nil
}

func (s *Service) AddBranchPhoto(ctx context.Context, actorID, branchID, mediaID uuid.UUID, sortOrder int) (*domain.BranchPhoto, error) {
	b, err := s.store.GetBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if b == nil {
		return nil, apperr.NotFound("branch not found")
	}
	if err := s.requireOwnerAdmin(ctx, b.OrganizationID, actorID); err != nil {
		return nil, err
	}
	if mediaID == uuid.Nil {
		return nil, apperr.Validation("media_id is required")
	}
	now := s.now().UTC()
	p := domain.BranchPhoto{
		ID: ids.New(), BranchID: branchID, MediaID: mediaID, SortOrder: sortOrder, CreatedAt: now,
	}
	if err := s.store.CreateBranchPhoto(ctx, p); err != nil {
		return nil, apperr.Internal(err)
	}
	return &p, nil
}

func (s *Service) DeleteBranchPhoto(ctx context.Context, actorID, photoID uuid.UUID) error {
	p, err := s.store.GetBranchPhoto(ctx, photoID)
	if err != nil {
		return apperr.Internal(err)
	}
	if p == nil {
		return apperr.NotFound("branch photo not found")
	}
	b, err := s.store.GetBranch(ctx, p.BranchID)
	if err != nil {
		return apperr.Internal(err)
	}
	if b == nil {
		return apperr.NotFound("branch not found")
	}
	if err := s.requireOwnerAdmin(ctx, b.OrganizationID, actorID); err != nil {
		return err
	}
	if err := s.store.DeleteBranchPhoto(ctx, photoID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("branch photo not found")
		}
		return apperr.Internal(err)
	}
	return nil
}
