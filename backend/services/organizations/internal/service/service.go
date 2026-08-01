package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
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
		Timezone: tz, CancelWindowHours: 12, AutoConfirm: false, CreatedAt: now, UpdatedAt: now,
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

func apperrOrNil(err error) error {
	if err != nil {
		return apperr.Internal(err)
	}
	return nil
}
