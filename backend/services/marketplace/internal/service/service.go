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
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store            *store.Store
	organizationsURL string
	bookingURL       string
	commerceURL      string
	internalToken    string
	httpClient       *http.Client
	now              func() time.Time
}

func New(st *store.Store) *Service {
	return &Service{store: st, httpClient: &http.Client{Timeout: 5 * time.Second}, now: time.Now}
}

func (s *Service) WithOrganizations(organizationsURL, internalToken string) *Service {
	s.organizationsURL = strings.TrimRight(organizationsURL, "/")
	s.internalToken = internalToken
	return s
}

func (s *Service) WithBooking(bookingURL string) *Service {
	s.bookingURL = strings.TrimRight(bookingURL, "/")
	return s
}

func (s *Service) WithCommerce(commerceURL string) *Service {
	s.commerceURL = strings.TrimRight(commerceURL, "/")
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
	ExperienceYears int
	Education       string
	PhotoMediaID    *uuid.UUID
	WorkType        string
	Published       bool
	AccessToken     string
}

func (s *Service) UpsertMaster(ctx context.Context, in UpsertMasterInput) (*domain.MasterProfile, error) {
	name := strings.TrimSpace(in.DisplayName)
	city := strings.TrimSpace(in.City)
	if name == "" || city == "" {
		return nil, apperr.Validation("display_name and city are required")
	}
	if in.ExperienceYears < 0 {
		return nil, apperr.Validation("experience_years must be >= 0")
	}
	workType := strings.TrimSpace(in.WorkType)
	if workType == "" {
		workType = "independent"
	}
	switch workType {
	case "employee", "renter", "chair_master", "owner", "salon_owner", "chain_owner", "independent", "private_master", "mobile_master":
	default:
		return nil, apperr.Validation("invalid work_type")
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
		City: city, ExperienceYears: in.ExperienceYears, Education: strings.TrimSpace(in.Education),
		PhotoMediaID: in.PhotoMediaID, WorkType: workType, Published: in.Published, UpdatedAt: now,
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
		if in.PhotoMediaID == nil {
			m.PhotoMediaID = existing.PhotoMediaID
		}
		if strings.TrimSpace(in.WorkType) == "" {
			m.WorkType = existing.WorkType
			if m.WorkType == "" {
				m.WorkType = "independent"
			}
		}
	}
	if m.Published {
		ready, err := s.evaluateReadiness(ctx, &m, in.AccessToken)
		if err != nil {
			return nil, err
		}
		if !ready.Ready {
			return nil, apperr.Validation("profile is not ready for publication: " + strings.Join(ready.Missing, ", "))
		}
	}
	if err := s.store.UpsertMaster(ctx, m); err != nil {
		return nil, apperr.Internal(err)
	}
	return &m, nil
}

func (s *Service) MasterReadiness(ctx context.Context, userID uuid.UUID, accessToken string) (*domain.Readiness, error) {
	m, err := s.store.GetMasterByUser(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if m == nil {
		return &domain.Readiness{
			Ready: false, Missing: []string{"profile"},
			Checks: []domain.ReadinessCheck{{Key: "profile", Label: "Профиль мастера", OK: false, Missing: "Создайте профиль"}},
		}, nil
	}
	return s.evaluateReadiness(ctx, m, accessToken)
}

func (s *Service) evaluateReadiness(ctx context.Context, m *domain.MasterProfile, accessToken string) (*domain.Readiness, error) {
	checks := []domain.ReadinessCheck{
		{Key: "display_name", Label: "Имя для публикации", OK: strings.TrimSpace(m.DisplayName) != ""},
		{Key: "city", Label: "Город", OK: strings.TrimSpace(m.City) != ""},
		{Key: "specializations", Label: "Специализация", OK: len(m.Specializations) > 0},
		{Key: "bio", Label: "Описание (от 10 символов)", OK: len([]rune(strings.TrimSpace(m.Bio))) >= 10},
		{Key: "experience", Label: "Опыт (лет)", OK: m.ExperienceYears > 0},
	}
	svcs, err := s.store.ListMasterServices(ctx, m.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	checks = append(checks, domain.ReadinessCheck{Key: "service", Label: "Хотя бы одна услуга", OK: len(svcs) > 0})
	hasHours := false
	if s.bookingURL != "" && accessToken != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.bookingURL+"/v1/me/working-hours", nil)
		if err == nil {
			req.Header.Set("Authorization", "Bearer "+accessToken)
			resp, err := s.httpClient.Do(req)
			if err == nil {
				defer resp.Body.Close()
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
				if resp.StatusCode < 300 {
					var payload struct {
						Items []struct {
							Weekday int `json:"weekday"`
						} `json:"items"`
					}
					_ = json.Unmarshal(body, &payload)
					hasHours = len(payload.Items) > 0
				}
			}
		}
	}
	checks = append(checks, domain.ReadinessCheck{Key: "schedule", Label: "Расписание", OK: hasHours})
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
	return &domain.Readiness{Ready: len(missing) == 0, Missing: missing, Checks: checks}, nil
}

func (s *Service) PopularServices(ctx context.Context) ([]domain.ServiceItem, error) {
	items, err := s.store.CountPopularServices(ctx, 12)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]domain.ServiceItem, 0, len(items))
	for _, item := range items {
		if item.BranchID == nil {
			// Masters without branch stay visible by master.published only (Stage 1).
			out = append(out, item)
			continue
		}
		ok, err := s.isBranchPublished(ctx, *item.BranchID)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, item)
		}
	}
	if out == nil {
		out = []domain.ServiceItem{}
	}
	return out, nil
}

func (s *Service) Search(ctx context.Context, city, q, service string, priceMin, priceMax *int64, availableOn *time.Time, includeOtherCities bool) ([]domain.MasterProfile, error) {
	items, err := s.store.SearchMasters(ctx, strings.TrimSpace(city), strings.TrimSpace(q), strings.TrimSpace(service), priceMin, priceMax, includeOtherCities, 50)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		return []domain.MasterProfile{}, nil
	}
	out := make([]domain.MasterProfile, 0, len(items))
	for _, m := range items {
		visible, err := s.isMasterPubliclyVisible(ctx, m)
		if err != nil {
			return nil, err
		}
		if !visible {
			continue
		}
		if availableOn != nil && s.bookingURL != "" {
			ok, err := s.hasAnySlotOn(ctx, m.UserID, *availableOn)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Service) hasAnySlotOn(ctx context.Context, masterUserID uuid.UUID, day time.Time) (bool, error) {
	day = day.UTC()
	u := fmt.Sprintf("%s/v1/masters/%s/slots?date=%s&duration_minutes=60",
		s.bookingURL, masterUserID.String(), day.Format("2006-01-02"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return false, apperr.Internal(err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return false, nil
	}
	var parsed struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return false, nil
	}
	return len(parsed.Items) > 0, nil
}

func (s *Service) GetMaster(ctx context.Context, id uuid.UUID) (*domain.MasterProfile, []domain.ServiceItem, error) {
	m, err := s.store.GetMaster(ctx, id)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if m == nil || !m.Published {
		return nil, nil, apperr.NotFound("master not found")
	}
	visible, err := s.isMasterPubliclyVisible(ctx, *m)
	if err != nil {
		return nil, nil, err
	}
	if !visible {
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
	services, err := s.store.ListMasterServicesAll(ctx, m.ID)
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
	Description     string
	Notes           string
	PhotoMediaID    *uuid.UUID
	DurationMinutes int
	PriceMinor      int64
	BookingMode     string
	AttachToMaster  bool
}

func normalizeBookingMode(mode string) (string, error) {
	mode = strings.TrimSpace(mode)
	if mode == "" {
		return "flexible", nil
	}
	switch mode {
	case "flexible", "fixed_window":
		return mode, nil
	default:
		return "", apperr.Validation("booking_mode must be flexible or fixed_window")
	}
}

func (s *Service) CreateService(ctx context.Context, in CreateServiceInput) (*domain.ServiceItem, error) {
	name := strings.TrimSpace(in.Name)
	category := strings.TrimSpace(in.Category)
	if name == "" || category == "" {
		return nil, apperr.Validation("name and category are required")
	}
	bookingMode, err := normalizeBookingMode(in.BookingMode)
	if err != nil {
		return nil, err
	}
	if bookingMode == "flexible" {
		if in.DurationMinutes <= 0 {
			return nil, apperr.Validation("duration_minutes must be positive")
		}
	} else if in.DurationMinutes < 0 {
		return nil, apperr.Validation("duration_minutes must be >= 0")
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
		Description: strings.TrimSpace(in.Description), Notes: strings.TrimSpace(in.Notes), PhotoMediaID: in.PhotoMediaID,
		DurationMinutes: in.DurationMinutes, PriceMinor: in.PriceMinor, Currency: "RUB", BookingMode: bookingMode,
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

type UpdateServiceInput struct {
	ActorUserID     uuid.UUID
	ServiceID       uuid.UUID
	Name            *string
	Category        *string
	Description     *string
	Notes           *string
	PhotoMediaID    *uuid.UUID
	ClearPhoto      bool
	DurationMinutes *int
	PriceMinor      *int64
	BookingMode     *string
	Published       *bool
	Archived        *bool
}

func (s *Service) UpdateService(ctx context.Context, in UpdateServiceInput) (*domain.ServiceItem, error) {
	item, err := s.store.GetService(ctx, in.ServiceID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if item == nil {
		return nil, apperr.NotFound("service not found")
	}
	if err := s.requireMembership(ctx, item.OrganizationID, in.ActorUserID, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return nil, apperr.Validation("name is required")
		}
		item.Name = name
	}
	if in.Category != nil {
		category := strings.TrimSpace(*in.Category)
		if category == "" {
			return nil, apperr.Validation("category is required")
		}
		item.Category = category
	}
	if in.Description != nil {
		item.Description = strings.TrimSpace(*in.Description)
	}
	if in.Notes != nil {
		item.Notes = strings.TrimSpace(*in.Notes)
	}
	if in.ClearPhoto {
		item.PhotoMediaID = nil
	} else if in.PhotoMediaID != nil {
		item.PhotoMediaID = in.PhotoMediaID
	}
	if in.BookingMode != nil {
		mode, err := normalizeBookingMode(*in.BookingMode)
		if err != nil {
			return nil, err
		}
		item.BookingMode = mode
	}
	if in.DurationMinutes != nil {
		mode := item.BookingMode
		if mode == "" {
			mode = "flexible"
		}
		if mode == "flexible" {
			if *in.DurationMinutes <= 0 {
				return nil, apperr.Validation("duration_minutes must be positive")
			}
		} else if *in.DurationMinutes < 0 {
			return nil, apperr.Validation("duration_minutes must be >= 0")
		}
		item.DurationMinutes = *in.DurationMinutes
	}
	if item.BookingMode == "flexible" && item.DurationMinutes <= 0 {
		return nil, apperr.Validation("duration_minutes must be positive")
	}
	if in.PriceMinor != nil {
		if *in.PriceMinor < 0 {
			return nil, apperr.Validation("price_minor must be >= 0")
		}
		item.PriceMinor = *in.PriceMinor
	}
	if in.Published != nil {
		item.Published = *in.Published
	}
	if in.Archived != nil {
		if *in.Archived {
			now := s.now().UTC()
			item.ArchivedAt = &now
		} else {
			item.ArchivedAt = nil
		}
	}
	item.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateService(ctx, *item); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return item, nil
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

func (s *Service) isMasterPubliclyVisible(ctx context.Context, m domain.MasterProfile) (bool, error) {
	if !m.Published {
		return false, nil
	}
	if m.BranchID == nil {
		// Masters without branch binding rely on master.published only (Stage1).
		return true, nil
	}
	return s.isBranchPublished(ctx, *m.BranchID)
}

func (s *Service) isBranchPublished(ctx context.Context, branchID uuid.UUID) (bool, error) {
	if s.organizationsURL == "" || s.internalToken == "" {
		return true, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.organizationsURL+"/v1/internal/branches/"+branchID.String()+"/publication", nil)
	if err != nil {
		return false, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode >= 300 {
		return false, apperr.Internal(fmt.Errorf("branch publication check status %d: %s", resp.StatusCode, string(body)))
	}
	var out struct {
		BranchPublished bool `json:"branch_published"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return false, apperr.Internal(err)
	}
	return out.BranchPublished, nil
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

func slugify(name string) string {
	s := strings.TrimSpace(strings.ToLower(name))
	s = strings.ReplaceAll(s, " ", "-")
	if s == "" {
		return ids.New().String()[:8]
	}
	return s
}

func (s *Service) ListServiceCategories(ctx context.Context) ([]domain.ServiceCategory, error) {
	items, err := s.store.ListServiceCategories(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ServiceCategory{}
	}
	return items, nil
}

func (s *Service) CreateServiceCategory(ctx context.Context, claims *auth.Claims, name, slug string) (*domain.ServiceCategory, error) {
	if !auth.HasRole(claims, "system_admin") {
		return nil, apperr.Forbidden("system_admin role required")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, apperr.Validation("name is required")
	}
	if slug = strings.TrimSpace(slug); slug == "" {
		slug = slugify(name)
	}
	now := s.now().UTC()
	c := domain.ServiceCategory{ID: ids.New(), Name: name, Slug: slug, CreatedAt: now}
	out, err := s.store.CreateServiceCategory(ctx, c)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return out, nil
}

func (s *Service) UpdateServiceCategory(ctx context.Context, claims *auth.Claims, id uuid.UUID, name, slug string) (*domain.ServiceCategory, error) {
	if !auth.HasRole(claims, "system_admin") {
		return nil, apperr.Forbidden("system_admin role required")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, apperr.Validation("name is required")
	}
	if slug = strings.TrimSpace(slug); slug == "" {
		slug = slugify(name)
	}
	c := domain.ServiceCategory{ID: id, Name: name, Slug: slug}
	if err := s.store.UpdateServiceCategory(ctx, c); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return &c, nil
}

func (s *Service) DeleteServiceCategory(ctx context.Context, claims *auth.Claims, id uuid.UUID) error {
	if !auth.HasRole(claims, "system_admin") {
		return apperr.Forbidden("system_admin role required")
	}
	if err := s.store.DeleteServiceCategory(ctx, id); err != nil {
		if ae, ok := apperr.As(err); ok {
			return ae
		}
		return apperr.Internal(err)
	}
	return nil
}
