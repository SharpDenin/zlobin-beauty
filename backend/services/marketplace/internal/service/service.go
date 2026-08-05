package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store             *store.Store
	organizationsURL  string
	internalToken     string
	httpClient        *http.Client
	now               func() time.Time
}

func New(st *store.Store) *Service {
	return &Service{store: st, httpClient: &http.Client{Timeout: 5 * time.Second}, now: time.Now}
}

func (s *Service) WithOrganizations(organizationsURL, internalToken string) *Service {
	s.organizationsURL = strings.TrimRight(organizationsURL, "/")
	s.internalToken = internalToken
	return s
}

type UpsertMasterInput struct {
	UserID          uuid.UUID
	OrganizationID  uuid.UUID
	BranchID        *uuid.UUID
	DisplayName     string
	Bio             string
	Specializations []string
	City            string
	Published       bool
}

func (s *Service) UpsertMaster(ctx context.Context, in UpsertMasterInput) (*domain.MasterProfile, error) {
	name := strings.TrimSpace(in.DisplayName)
	city := strings.TrimSpace(in.City)
	if name == "" || city == "" {
		return nil, apperr.Validation("display_name and city are required")
	}
	if err := s.requireMembership(ctx, in.OrganizationID, in.UserID, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	existing, err := s.store.GetMasterByUser(ctx, in.UserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	m := domain.MasterProfile{
		UserID: in.UserID, OrganizationID: in.OrganizationID, BranchID: in.BranchID,
		DisplayName: name, Bio: strings.TrimSpace(in.Bio), Specializations: in.Specializations,
		City: city, Published: in.Published, UpdatedAt: now,
	}
	if m.Specializations == nil {
		m.Specializations = []string{}
	}
	if existing == nil {
		m.ID = ids.New()
		m.CreatedAt = now
	} else {
		m.ID = existing.ID
		m.CreatedAt = existing.CreatedAt
		m.RatingAvg = existing.RatingAvg
		m.RatingCount = existing.RatingCount
	}
	if err := s.store.UpsertMaster(ctx, m); err != nil {
		return nil, apperr.Internal(err)
	}
	return &m, nil
}

func (s *Service) Search(ctx context.Context, city, q string) ([]domain.MasterProfile, error) {
	items, err := s.store.SearchMasters(ctx, strings.TrimSpace(city), strings.TrimSpace(q), 50)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.MasterProfile{}
	}
	return items, nil
}

func (s *Service) GetMaster(ctx context.Context, id uuid.UUID) (*domain.MasterProfile, []domain.ServiceItem, error) {
	m, err := s.store.GetMaster(ctx, id)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if m == nil || !m.Published {
		return nil, nil, apperr.NotFound("master not found")
	}
	services, err := s.store.ListMasterServices(ctx, m.ID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if services == nil {
		services = []domain.ServiceItem{}
	}
	return m, services, nil
}

func (s *Service) GetMasterByUserID(ctx context.Context, userID uuid.UUID) (*domain.MasterProfile, error) {
	m, err := s.store.GetMasterByUser(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if m == nil {
		return nil, apperr.NotFound("master not found")
	}
	return m, nil
}

func (s *Service) GetMyMaster(ctx context.Context, userID uuid.UUID) (*domain.MasterProfile, []domain.ServiceItem, error) {
	m, err := s.store.GetMasterByUser(ctx, userID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if m == nil {
		return nil, nil, apperr.NotFound("master profile not found")
	}
	services, err := s.store.ListMasterServices(ctx, m.ID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if services == nil {
		services = []domain.ServiceItem{}
	}
	return m, services, nil
}

type CreateServiceInput struct {
	ActorUserID     uuid.UUID
	OrganizationID  uuid.UUID
	Name            string
	Category        string
	DurationMinutes int
	PriceMinor      int64
	AttachToMaster  bool
}

func (s *Service) CreateService(ctx context.Context, in CreateServiceInput) (*domain.ServiceItem, error) {
	name := strings.TrimSpace(in.Name)
	category := strings.TrimSpace(in.Category)
	if name == "" || category == "" {
		return nil, apperr.Validation("name and category are required")
	}
	if in.DurationMinutes <= 0 {
		return nil, apperr.Validation("duration_minutes must be positive")
	}
	if in.PriceMinor < 0 {
		return nil, apperr.Validation("price_minor must be >= 0")
	}
	if err := s.requireMembership(ctx, in.OrganizationID, in.ActorUserID, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	item := domain.ServiceItem{
		ID: ids.New(), OrganizationID: in.OrganizationID, Name: name, Category: category,
		DurationMinutes: in.DurationMinutes, PriceMinor: in.PriceMinor, Currency: "RUB",
		Published: true, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateService(ctx, item); err != nil {
		return nil, apperr.Internal(err)
	}
	if in.AttachToMaster {
		master, err := s.store.GetMasterByUser(ctx, in.ActorUserID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if master == nil {
			return nil, apperr.Validation("create master profile before attaching services")
		}
		if master.OrganizationID != in.OrganizationID {
			return nil, apperr.Forbidden("service organization mismatch")
		}
		if err := s.store.AttachService(ctx, master.ID, item.ID); err != nil {
			return nil, apperr.Internal(err)
		}
	}
	return &item, nil
}

func (s *Service) GetService(ctx context.Context, id uuid.UUID) (*domain.ServiceItem, error) {
	item, err := s.store.GetService(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if item == nil {
		return nil, apperr.NotFound("service not found")
	}
	return item, nil
}

func (s *Service) requireMembership(ctx context.Context, orgID, userID uuid.UUID, roles ...string) error {
	if s.organizationsURL == "" || s.internalToken == "" {
		return apperr.Internal(fmt.Errorf("organizations membership check is not configured"))
	}
	q := url.Values{}
	q.Set("organization_id", orgID.String())
	q.Set("user_id", userID.String())
	for _, role := range roles {
		q.Add("role", role)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.organizationsURL+"/v1/internal/memberships/check?"+q.Encode(), nil)
	if err != nil {
		return apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return apperr.Internal(fmt.Errorf("membership check status %d: %s", resp.StatusCode, string(body)))
	}
	var out struct {
		Active bool `json:"active"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return apperr.Internal(err)
	}
	if !out.Active {
		return apperr.Forbidden("not a member of organization")
	}
	return nil
}
