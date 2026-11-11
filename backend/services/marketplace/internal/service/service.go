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
	"github.com/zlobin/zlobin-beauty/backend/shared/moderation"
)

type Service struct {
	store             *store.Store
	organizationsURL  string
	bookingURL        string
	commerceURL       string
	clientsURL        string
	communicationsURL string
	identityURL       string
	mediaURL          string
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

func (s *Service) WithBooking(bookingURL string) *Service {
	s.bookingURL = strings.TrimRight(bookingURL, "/")
	return s
}

func (s *Service) WithCommerce(commerceURL string) *Service {
	s.commerceURL = strings.TrimRight(commerceURL, "/")
	return s
}

type UpsertMasterInput struct {
	UserID            uuid.UUID
	OrganizationID    uuid.UUID
	BranchID          *uuid.UUID
	DisplayName       string
	Bio               string
	Specializations   []string
	City              string
	ExperienceYears   int
	Education         string
	PhotoMediaID      *uuid.UUID
	WorkType          string
	WorkTypes         *[]string // nil = field omitted (preserve existing); non-nil replaces formats
	Published         bool
	AccessToken       string
	ProfessionTypeIDs *[]uuid.UUID
}

// Canonical master work formats (employment model). Ownership and org membership are separate.
var canonicalWorkTypes = map[string]struct{}{
	"private_practice": {},
	"percentage_based": {},
	"mobile_service":   {},
	"chair_rental":     {},
}

func normalizeWorkType(workType string) string {
	raw := strings.TrimSpace(strings.ToLower(workType))
	switch raw {
	case "independent", "private_master":
		return "private_practice"
	case "mobile_master":
		return "mobile_service"
	case "renter", "chair_master":
		return "chair_rental"
	case "private_practice", "percentage_based", "mobile_service", "chair_rental":
		return raw
	case "owner", "salon_owner", "chain_owner":
		// Ownership is not a work format — strip on write path.
		return ""
	default:
		return raw
	}
}

func isCanonicalWorkType(code string) bool {
	_, ok := canonicalWorkTypes[code]
	return ok
}

// workTypeNeedsOrganization is retained for tests/diagnostics; formats alone never require an org.
func workTypeNeedsOrganization(workType string) bool {
	_ = workType
	return false
}

func workTypesNeedOrganization(types []string) bool {
	_ = types
	return false
}

func primaryWorkType(types []string, fallback string) string {
	if len(types) > 0 {
		return types[0]
	}
	fb := normalizeWorkType(fallback)
	if isCanonicalWorkType(fb) {
		return fb
	}
	return "private_practice"
}

func normalizeWorkTypes(raw []string, fallback string) ([]string, string, error) {
	seen := map[string]struct{}{}
	var out []string
	add := func(v string) error {
		n := normalizeWorkType(v)
		if n == "" {
			return nil
		}
		if n == "employee" {
			return apperr.Validation("employee is not a work format; use organization membership")
		}
		if !isCanonicalWorkType(n) {
			return apperr.Validation("invalid work_type")
		}
		if _, ok := seen[n]; ok {
			return nil
		}
		seen[n] = struct{}{}
		out = append(out, n)
		return nil
	}
	hadInput := len(raw) > 0 || strings.TrimSpace(fallback) != ""
	for _, t := range raw {
		if err := add(t); err != nil {
			return nil, "", err
		}
	}
	if len(out) == 0 && strings.TrimSpace(fallback) != "" {
		if err := add(fallback); err != nil {
			return nil, "", err
		}
	}
	if len(out) == 0 {
		if hadInput {
			return nil, "", apperr.Validation("invalid work_type")
		}
		out = []string{"private_practice"}
	}
	return out, primaryWorkType(out, fallback), nil
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
	fields := map[string]string{
		"display_name": name,
		"bio":          strings.TrimSpace(in.Bio),
		"education":    strings.TrimSpace(in.Education),
		"city":         city,
	}
	if len(in.Specializations) > 0 {
		fields["specializations"] = strings.Join(in.Specializations, " ")
	}
	if err := moderation.ValidateFields(fields); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	existing, err := s.store.GetMasterByUser(ctx, in.UserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}

	var workTypes []string
	var workType string
	preserveFormats := in.WorkTypes == nil && strings.TrimSpace(in.WorkType) == ""
	if preserveFormats && existing != nil {
		workTypes = existing.WorkTypes
		workType = existing.WorkType
		if len(workTypes) == 0 && workType != "" {
			workTypes = []string{workType}
		}
		if workType == "" {
			workType = "private_practice"
			workTypes = []string{"private_practice"}
		}
	} else {
		rawTypes := []string{}
		if in.WorkTypes != nil {
			rawTypes = *in.WorkTypes
		} else if strings.TrimSpace(in.WorkType) != "" {
			rawTypes = []string{in.WorkType}
		}
		workTypes, workType, err = normalizeWorkTypes(rawTypes, in.WorkType)
		if err != nil {
			return nil, err
		}
	}

	orgID := in.OrganizationID
	if orgID == uuid.Nil && existing != nil {
		orgID = existing.OrganizationID
	}
	if orgID != uuid.Nil {
		if err := s.requireMembership(ctx, orgID, in.UserID, "owner", "admin", "master"); err != nil {
			return nil, err
		}
	}
	m := domain.MasterProfile{
		UserID: in.UserID, OrganizationID: orgID, BranchID: in.BranchID,
		DisplayName: name, Bio: strings.TrimSpace(in.Bio),
		City: city, ExperienceYears: in.ExperienceYears, Education: strings.TrimSpace(in.Education),
		PhotoMediaID: in.PhotoMediaID, WorkType: workType, WorkTypes: workTypes, Published: in.Published, UpdatedAt: now,
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
	}
	if existing == nil && (in.ProfessionTypeIDs == nil || len(*in.ProfessionTypeIDs) == 0) {
		return nil, apperr.ProfessionTypesRequired()
	}
	typesChanged := false
	if in.ProfessionTypeIDs != nil {
		for _, id := range *in.ProfessionTypeIDs {
			m.ProfessionTypes = append(m.ProfessionTypes, domain.ProfessionType{ID: id})
		}
		if existing != nil {
			prevTypes, err := s.store.ListMasterProfessionTypes(ctx, in.UserID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			typesChanged = !sameProfessionTypeIDs(prevTypes, *in.ProfessionTypeIDs)
		} else {
			typesChanged = true
		}
	} else if existing != nil {
		types, err := s.store.ListMasterProfessionTypes(ctx, in.UserID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		m.ProfessionTypes = types
	}
	slugs, err := s.professionSlugsForTypes(ctx, m.ProfessionTypes)
	if err != nil {
		return nil, err
	}
	specs, err := resolveSpecializations(in.Specializations, slugs, existing, typesChanged)
	if err != nil {
		return nil, err
	}
	m.Specializations = specs
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
	if err := s.applyProfessionTypes(ctx, &m, in.ProfessionTypeIDs, existing == nil); err != nil {
		return nil, err
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
	if len(m.ProfessionTypes) == 0 {
		types, err := s.store.ListMasterProfessionTypes(ctx, m.UserID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		m.ProfessionTypes = types
	}
	checks := []domain.ReadinessCheck{
		{Key: "display_name", Label: "Имя для публикации", OK: strings.TrimSpace(m.DisplayName) != ""},
		{Key: "city", Label: "Город", OK: strings.TrimSpace(m.City) != ""},
		{Key: "specializations", Label: "Специализация", OK: domain.HasValidSpecialization(m.Specializations)},
		{Key: "profession_types", Label: "Профессиональный тип", OK: len(m.ProfessionTypes) > 0},
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

type SearchHit struct {
	Master        domain.MasterProfile
	Onsite        *OnsiteMatch
	ServiceNames  []string
	PriceMinMinor *int64
	PriceMaxMinor *int64
	CityRank      int
}

type OnsiteMatch struct {
	City      string
	Districts []string
	StartsAt  time.Time
	EndsAt    time.Time
	Badge     string
}

type SearchInput struct {
	City               string
	Q                  string
	Service            string
	PriceMin           *int64
	PriceMax           *int64
	AvailableOn        *time.Time
	IncludeOtherCities bool
	DistrictID         *uuid.UUID
	Limit              int
	Cursor             *store.SearchCursor
}

type SearchResult struct {
	Items      []SearchHit
	NextCursor *store.SearchCursor
	HasMore    bool
}

const searchDefaultLimit = 50
const searchMaxLimit = 50

func (s *Service) Search(ctx context.Context, in SearchInput) (*SearchResult, error) {
	if in.DistrictID != nil && in.AvailableOn == nil {
		return nil, apperr.Validation("available_on is required when district_id is set")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = searchDefaultLimit
	}
	if limit > searchMaxLimit {
		limit = searchMaxLimit
	}
	city := strings.TrimSpace(in.City)
	rows, err := s.store.SearchMasters(ctx, store.SearchMastersParams{
		City: city, Q: strings.TrimSpace(in.Q), Service: strings.TrimSpace(in.Service),
		PriceMin: in.PriceMin, PriceMax: in.PriceMax, IncludeOtherCities: in.IncludeOtherCities,
		Limit: limit + 1, Cursor: in.Cursor,
	})
	if err != nil {
		return nil, apperr.Internal(err)
	}
	hasMoreSQL := len(rows) > limit
	if hasMoreSQL {
		rows = rows[:limit]
	}
	var nextCursor *store.SearchCursor
	if hasMoreSQL && len(rows) > 0 {
		last := rows[len(rows)-1]
		nextCursor = &store.SearchCursor{
			CityRank: last.CityRank, RatingAvg: last.Master.RatingAvg,
			RatingCount: last.Master.RatingCount, ID: last.Master.ID,
		}
	}

	matches := map[uuid.UUID]OnsiteMatch{}
	if in.DistrictID != nil && in.AvailableOn != nil {
		got, err := s.fetchOnsiteMatches(ctx, city, *in.DistrictID, *in.AvailableOn)
		if err != nil {
			return nil, err
		}
		matches = got
	}

	activeUsers, err := s.activeMasterUserIDs(ctx, rows)
	if err != nil {
		return nil, err
	}

	hits := make([]SearchHit, 0, len(rows))
	ptrs := make([]*domain.MasterProfile, 0, len(rows))
	for i := range rows {
		row := rows[i]
		if _, ok := activeUsers[row.Master.UserID]; !ok {
			continue
		}
		if in.AvailableOn != nil && s.bookingURL != "" && in.DistrictID == nil {
			ok, err := s.hasAnySlotOn(ctx, row.Master.UserID, *in.AvailableOn)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
		}
		hit := SearchHit{
			Master:        row.Master,
			ServiceNames:  row.ServiceNames,
			PriceMinMinor: row.PriceMinMinor,
			PriceMaxMinor: row.PriceMaxMinor,
			CityRank:      row.CityRank,
		}
		if hit.ServiceNames == nil {
			hit.ServiceNames = []string{}
		}
		if in.DistrictID != nil {
			match, ok := matches[row.Master.UserID]
			if !ok {
				continue
			}
			hit.Onsite = &match
		}
		hits = append(hits, hit)
		ptrs = append(ptrs, &hits[len(hits)-1].Master)
	}
	if err := s.attachProfessionTypes(ctx, ptrs...); err != nil {
		return nil, err
	}
	return &SearchResult{Items: hits, NextCursor: nextCursor, HasMore: hasMoreSQL}, nil
}

// activeMasterUserIDs asks identity which owners are still active (excludes blocked/deleted).
// When identity is not wired OR the batch call fails, fall open to the SQL published filter
// so a transient identity outage cannot empty public search for valid masters.
func (s *Service) activeMasterUserIDs(ctx context.Context, rows []store.SearchMasterRow) (map[uuid.UUID]struct{}, error) {
	out := make(map[uuid.UUID]struct{}, len(rows))
	allowAll := func() map[uuid.UUID]struct{} {
		for _, row := range rows {
			if row.Master.UserID != uuid.Nil {
				out[row.Master.UserID] = struct{}{}
			}
		}
		return out
	}
	if len(rows) == 0 {
		return out, nil
	}
	if s.identityURL == "" || s.internalToken == "" {
		return allowAll(), nil
	}
	seen := map[uuid.UUID]struct{}{}
	parts := make([]string, 0, len(rows))
	for _, row := range rows {
		id := row.Master.UserID
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		parts = append(parts, id.String())
	}
	if len(parts) == 0 {
		return out, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.identityURL+"/v1/internal/users/batch?ids="+strings.Join(parts, ","), nil)
	if err != nil {
		return allowAll(), nil
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return allowAll(), nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return allowAll(), nil
	}
	var parsed struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return allowAll(), nil
	}
	for _, it := range parsed.Items {
		id, err := uuid.Parse(it.ID)
		if err != nil || id == uuid.Nil {
			continue
		}
		out[id] = struct{}{}
	}
	return out, nil
}

func (s *Service) fetchOnsiteMatches(ctx context.Context, city string, districtID uuid.UUID, day time.Time) (map[uuid.UUID]OnsiteMatch, error) {
	out := map[uuid.UUID]OnsiteMatch{}
	if s.bookingURL == "" {
		return out, nil
	}
	u := fmt.Sprintf("%s/v1/internal/onsite-matches?city=%s&district_id=%s&date=%s",
		s.bookingURL, url.QueryEscape(city), districtID.String(), day.Format("2006-01-02"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if s.internalToken != "" {
		req.Header.Set("X-Internal-Token", s.internalToken)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return out, nil
	}
	var parsed struct {
		Items []struct {
			MasterUserID string    `json:"master_user_id"`
			StartsAt     time.Time `json:"starts_at"`
			EndsAt       time.Time `json:"ends_at"`
			City         string    `json:"city"`
			Districts    []string  `json:"districts"`
			Badge        string    `json:"badge"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return out, nil
	}
	for _, it := range parsed.Items {
		id, err := uuid.Parse(it.MasterUserID)
		if err != nil {
			continue
		}
		badge := it.Badge
		if badge == "" {
			badge = "Выезд в вашем районе"
		}
		if _, exists := out[id]; exists {
			continue
		}
		out[id] = OnsiteMatch{City: it.City, Districts: it.Districts, StartsAt: it.StartsAt, EndsAt: it.EndsAt, Badge: badge}
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
	if m == nil {
		return nil, nil, apperr.NotFound("master not found")
	}
	services, err := s.store.ListMasterServices(ctx, m.ID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if services == nil {
		services = []domain.ServiceItem{}
	}
	if err := s.attachProfessionTypes(ctx, m); err != nil {
		return nil, nil, err
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
	if err := s.attachProfessionTypes(ctx, m); err != nil {
		return nil, err
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
	if err := s.attachProfessionTypes(ctx, m); err != nil {
		return nil, nil, err
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
	Published       *bool
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
	if err := moderation.ValidateFields(map[string]string{
		"name":        name,
		"category":    category,
		"description": strings.TrimSpace(in.Description),
		"notes":       strings.TrimSpace(in.Notes),
	}); err != nil {
		return nil, err
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
	orgID, err := s.resolveServiceOrganizationID(ctx, in.ActorUserID, in.OrganizationID, in.AttachToMaster)
	if err != nil {
		return nil, err
	}
	if err := s.requireMembership(ctx, orgID, in.ActorUserID, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	item := domain.ServiceItem{
		ID: ids.New(), OrganizationID: orgID, Name: name, Category: category,
		Description: strings.TrimSpace(in.Description), Notes: strings.TrimSpace(in.Notes), PhotoMediaID: in.PhotoMediaID,
		DurationMinutes: in.DurationMinutes, PriceMinor: in.PriceMinor, Currency: "RUB", BookingMode: bookingMode,
		Published: published, CreatedAt: now, UpdatedAt: now,
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
		// Independent masters may attach services from a membership org without binding profile.organization_id.
		if master.OrganizationID != uuid.Nil && master.OrganizationID != orgID {
			return nil, apperr.Forbidden("service organization mismatch")
		}
		if err := s.store.AttachService(ctx, master.ID, item.ID); err != nil {
			return nil, apperr.Internal(err)
		}
	}
	return &item, nil
}

// resolveServiceOrganizationID picks the workspace org for a new service.
// Solo/independent masters often have NULL master_profiles.organization_id while owning a salon org.
func (s *Service) resolveServiceOrganizationID(ctx context.Context, actor, requested uuid.UUID, attachToMaster bool) (uuid.UUID, error) {
	if requested != uuid.Nil {
		return requested, nil
	}
	if !attachToMaster {
		return uuid.Nil, apperr.Validation("organization_id is required")
	}
	master, err := s.store.GetMasterByUser(ctx, actor)
	if err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	if master == nil {
		return uuid.Nil, apperr.Validation("create master profile before attaching services")
	}
	if master.OrganizationID != uuid.Nil {
		return master.OrganizationID, nil
	}
	orgID, err := s.firstOwnedSalonOrganization(ctx, actor)
	if err != nil {
		return uuid.Nil, err
	}
	if orgID == uuid.Nil {
		return uuid.Nil, apperr.Validation("organization_id is required: create or join a salon workspace first")
	}
	return orgID, nil
}

func (s *Service) firstOwnedSalonOrganization(ctx context.Context, userID uuid.UUID) (uuid.UUID, error) {
	if s.organizationsURL == "" || s.internalToken == "" {
		return uuid.Nil, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.organizationsURL+"/v1/internal/users/"+userID.String()+"/owned-organizations", nil)
	if err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return uuid.Nil, apperr.Internal(fmt.Errorf("owned-organizations status %d", resp.StatusCode))
	}
	var parsed struct {
		Items []struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	for _, it := range parsed.Items {
		if strings.EqualFold(strings.TrimSpace(it.Type), "supplier") {
			continue
		}
		id, err := uuid.Parse(it.ID)
		if err != nil || id == uuid.Nil {
			continue
		}
		return id, nil
	}
	return uuid.Nil, nil
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

func (s *Service) ListPublishedServicesByOrg(ctx context.Context, orgID uuid.UUID) ([]domain.ServiceItem, error) {
	items, err := s.store.ListPublishedServicesByOrg(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ServiceItem{}
	}
	return items, nil
}

func (s *Service) ListMastersOfferingService(ctx context.Context, serviceID uuid.UUID) ([]domain.MasterProfile, error) {
	if _, err := s.GetService(ctx, serviceID); err != nil {
		return nil, err
	}
	items, err := s.store.ListMastersOfferingService(ctx, serviceID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.MasterProfile{}
	}
	return items, nil
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
