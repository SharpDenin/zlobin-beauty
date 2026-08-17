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
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

// allRoles lists every membership role known to the organizations service;
// used when a commerce endpoint only needs "is a member" without a specific
// role requirement.
var allRoles = []string{"owner", "admin", "master", "staff", "rep"}

type Service struct {
	store            *store.Store
	organizationsURL string
	bookingURL       string
	internalToken    string
	httpClient       *http.Client
	now              func() time.Time
}

func New(st *store.Store) *Service {
	return &Service{store: st, httpClient: &http.Client{Timeout: 5 * time.Second}, now: time.Now}
}

func (s *Service) WithIntegrations(organizationsURL, internalToken string) *Service {
	s.organizationsURL = strings.TrimRight(organizationsURL, "/")
	s.internalToken = internalToken
	return s
}

func (s *Service) WithBooking(bookingURL string) *Service {
	s.bookingURL = strings.TrimRight(bookingURL, "/")
	return s
}

// requireMembership verifies the actor has an active membership in the
// organization with one of the given roles, via the organizations service's
// internal membership-check endpoint.
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

func (s *Service) requireAnyMembership(ctx context.Context, orgID, userID uuid.UUID) error {
	return s.requireMembership(ctx, orgID, userID, allRoles...)
}

// --- stock locations ---

var validLocationKinds = map[string]bool{
	domain.LocationSalon: true, domain.LocationMaster: true, domain.LocationSupplier: true, domain.LocationTransit: true,
}

func (s *Service) CreateLocation(ctx context.Context, actor, orgID uuid.UUID, name, kind string) (*domain.StockLocation, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, apperr.Validation("name is required")
	}
	if !validLocationKinds[kind] {
		return nil, apperr.Validation("kind must be one of salon, master, supplier, transit")
	}
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	l := domain.StockLocation{ID: ids.New(), OrganizationID: orgID, Name: name, Kind: kind, CreatedAt: s.now().UTC()}
	if err := s.store.CreateLocation(ctx, l); err != nil {
		return nil, apperr.Internal(err)
	}
	return &l, nil
}

func (s *Service) ListLocations(ctx context.Context, actor, orgID uuid.UUID) ([]domain.StockLocation, error) {
	if err := s.requireAnyMembership(ctx, orgID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListLocations(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.StockLocation{}
	}
	return items, nil
}

func (s *Service) getLocationOrErr(ctx context.Context, id uuid.UUID) (*domain.StockLocation, error) {
	l, err := s.store.GetLocation(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if l == nil {
		return nil, apperr.NotFound("location not found")
	}
	return l, nil
}

// --- products ---

type ProductInput struct {
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
	ForSale        bool
	DeliveryDays   int
	PhotoMediaID   *uuid.UUID
	Audience       string
}

func (s *Service) CreateProduct(ctx context.Context, actor uuid.UUID, in ProductInput) (*domain.Product, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, apperr.Validation("name is required")
	}
	if in.PriceMinor < 0 {
		return nil, apperr.Validation("price_minor must not be negative")
	}
	if in.MinStock < 0 {
		return nil, apperr.Validation("min_stock must not be negative")
	}
	if in.DeliveryDays < 0 {
		return nil, apperr.Validation("delivery_days must not be negative")
	}
	if err := s.requireMembership(ctx, in.OrganizationID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	var parentID *uuid.UUID
	if in.ParentID != nil {
		parent, err := s.store.GetProduct(ctx, *in.ParentID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if parent == nil {
			return nil, apperr.Validation("parent product not found")
		}
		if parent.OrganizationID != in.OrganizationID {
			return nil, apperr.Validation("parent product must belong to the same organization")
		}
		if parent.ParentID != nil {
			return nil, apperr.Validation("parent must be a root product (not a variant)")
		}
		parentID = in.ParentID
	}
	unit := strings.TrimSpace(in.Unit)
	if unit == "" {
		unit = "pcs"
	}
	currency := strings.TrimSpace(in.Currency)
	if currency == "" {
		currency = "RUB"
	}
	now := s.now().UTC()
	deliveryDays := in.DeliveryDays
	if deliveryDays == 0 {
		deliveryDays = 3
	}
	p := domain.Product{
		ID: ids.New(), OrganizationID: in.OrganizationID, ParentID: parentID, CategoryID: in.CategoryID, Brand: strings.TrimSpace(in.Brand),
		Name: name, SKU: strings.TrimSpace(in.SKU), Description: strings.TrimSpace(in.Description), Unit: unit,
		VolumeLabel: strings.TrimSpace(in.VolumeLabel), PriceMinor: in.PriceMinor, Currency: currency,
		MinStock: in.MinStock, Published: in.Published, ForSale: in.ForSale, DeliveryDays: deliveryDays,
		PhotoMediaID: in.PhotoMediaID, Audience: normalizeAudience(in.Audience), CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateProduct(ctx, p); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return &p, nil
}

func (s *Service) getProductOrErr(ctx context.Context, id uuid.UUID) (*domain.Product, error) {
	p, err := s.store.GetProduct(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if p == nil {
		return nil, apperr.NotFound("product not found")
	}
	return p, nil
}

func normalizeAudience(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), "professional_only") {
		return "professional_only"
	}
	return "all"
}

func (s *Service) GetProduct(ctx context.Context, actor, id uuid.UUID) (*domain.Product, error) {
	p, err := s.getProductOrErr(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.requireAnyMembership(ctx, p.OrganizationID, actor); err == nil {
		return p, nil
	}
	if p.Published && p.ForSale {
		return p, nil
	}
	if p.Published {
		return p, nil
	}
	return nil, apperr.NotFound("product not found")
}

func (s *Service) ListProducts(ctx context.Context, actor, orgID uuid.UUID) ([]domain.Product, error) {
	memberErr := s.requireAnyMembership(ctx, orgID, actor)
	items, err := s.store.ListProducts(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Product{}
	}
	// Non-members may browse published for-sale catalog.
	if memberErr != nil {
		out := make([]domain.Product, 0, len(items))
		for _, p := range items {
		if p.Published && p.ForSale && p.ArchivedAt == nil {
				out = append(out, p)
			}
		}
		return out, nil
	}
	return items, nil
}

type ProductPatch struct {
	CategoryID   *uuid.UUID
	Brand        *string
	Name         *string
	SKU          *string
	Description  *string
	Unit         *string
	VolumeLabel  *string
	PriceMinor   *int64
	Currency     *string
	MinStock     *float64
	Published    *bool
	ForSale      *bool
	DeliveryDays *int
	PhotoMediaID *uuid.UUID
	ClearPhoto   bool
	Audience     *string
}

func (s *Service) UpdateProduct(ctx context.Context, actor, id uuid.UUID, patch ProductPatch) (*domain.Product, error) {
	p, err := s.getProductOrErr(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.requireMembership(ctx, p.OrganizationID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	if patch.CategoryID != nil {
		p.CategoryID = patch.CategoryID
	}
	if patch.Brand != nil {
		p.Brand = strings.TrimSpace(*patch.Brand)
	}
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		if name == "" {
			return nil, apperr.Validation("name must not be empty")
		}
		p.Name = name
	}
	if patch.SKU != nil {
		p.SKU = strings.TrimSpace(*patch.SKU)
	}
	if patch.Description != nil {
		p.Description = strings.TrimSpace(*patch.Description)
	}
	if patch.Unit != nil {
		unit := strings.TrimSpace(*patch.Unit)
		if unit == "" {
			unit = "pcs"
		}
		p.Unit = unit
	}
	if patch.VolumeLabel != nil {
		p.VolumeLabel = strings.TrimSpace(*patch.VolumeLabel)
	}
	if patch.PriceMinor != nil {
		if *patch.PriceMinor < 0 {
			return nil, apperr.Validation("price_minor must not be negative")
		}
		p.PriceMinor = *patch.PriceMinor
	}
	if patch.Currency != nil {
		currency := strings.TrimSpace(*patch.Currency)
		if currency == "" {
			currency = "RUB"
		}
		p.Currency = currency
	}
	if patch.MinStock != nil {
		if *patch.MinStock < 0 {
			return nil, apperr.Validation("min_stock must not be negative")
		}
		p.MinStock = *patch.MinStock
	}
	if patch.Published != nil {
		p.Published = *patch.Published
	}
	if patch.ForSale != nil {
		p.ForSale = *patch.ForSale
	}
	if patch.DeliveryDays != nil {
		if *patch.DeliveryDays < 0 {
			return nil, apperr.Validation("delivery_days must not be negative")
		}
		p.DeliveryDays = *patch.DeliveryDays
	}
	if patch.ClearPhoto {
		p.PhotoMediaID = nil
	} else if patch.PhotoMediaID != nil {
		p.PhotoMediaID = patch.PhotoMediaID
	}
	if patch.Audience != nil {
		p.Audience = normalizeAudience(*patch.Audience)
	}
	p.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateProduct(ctx, *p); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return p, nil
}

// --- stock movements & balances ---

func resolveMovementDelta(kind string, qty float64) (float64, error) {
	switch kind {
	case domain.MovementReceipt, domain.MovementReturn:
		if qty <= 0 {
			return 0, apperr.Validation("qty must be positive for " + kind)
		}
		return qty, nil
	case domain.MovementWriteOff, domain.MovementConsumption:
		if qty <= 0 {
			return 0, apperr.Validation("qty must be positive for " + kind)
		}
		return -qty, nil
	case domain.MovementAdjust:
		if qty == 0 {
			return 0, apperr.Validation("qty must be non-zero for adjust")
		}
		return qty, nil
	case domain.MovementReserve, domain.MovementUnreserve, domain.MovementRelease, domain.MovementShipment:
		if qty <= 0 {
			return 0, apperr.Validation("qty must be positive for " + kind)
		}
		return qty, nil
	default:
		return 0, apperr.Validation("kind must be one of receipt, adjust, write_off, consumption, return, reserve, unreserve, release, shipment")
	}
}

type MovementInput struct {
	LocationID uuid.UUID
	ProductID  uuid.UUID
	Kind       string
	Qty        float64
	Reason     string
}

func (s *Service) CreateMovement(ctx context.Context, actor uuid.UUID, in MovementInput) (*domain.StockMovement, error) {
	loc, err := s.getLocationOrErr(ctx, in.LocationID)
	if err != nil {
		return nil, err
	}
	if _, err := s.getProductOrErr(ctx, in.ProductID); err != nil {
		return nil, err
	}
	if err := s.requireMembership(ctx, loc.OrganizationID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	delta, err := resolveMovementDelta(in.Kind, in.Qty)
	if err != nil {
		return nil, err
	}
	m := domain.StockMovement{
		ID: ids.New(), LocationID: in.LocationID, ProductID: in.ProductID, Kind: in.Kind, Qty: delta,
		Reason: strings.TrimSpace(in.Reason), ActorUserID: actor, CreatedAt: s.now().UTC(),
	}
	out, err := s.store.CreateMovement(ctx, m)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return out, nil
}

func (s *Service) ListStock(ctx context.Context, actor, locationID uuid.UUID) ([]domain.StockBalanceView, error) {
	loc, err := s.getLocationOrErr(ctx, locationID)
	if err != nil {
		return nil, err
	}
	if err := s.requireAnyMembership(ctx, loc.OrganizationID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListBalancesByLocation(ctx, locationID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	incoming, _ := s.store.IncomingByProduct(ctx, loc.OrganizationID)
	for i := range items {
		items[i].QtyIncoming = incoming[items[i].ProductID]
	}
	if items == nil {
		items = []domain.StockBalanceView{}
	}
	return items, nil
}

func (s *Service) ListMovements(ctx context.Context, actor, locationID uuid.UUID) ([]domain.StockMovement, error) {
	loc, err := s.getLocationOrErr(ctx, locationID)
	if err != nil {
		return nil, err
	}
	if err := s.requireAnyMembership(ctx, loc.OrganizationID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListMovements(ctx, locationID, 40)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

// --- consumption norms ---

func (s *Service) CreateNorm(ctx context.Context, actor, orgID, serviceID, productID uuid.UUID, qty float64, required bool) (*domain.ConsumptionNorm, error) {
	if qty <= 0 {
		return nil, apperr.Validation("qty must be positive")
	}
	if serviceID == uuid.Nil || productID == uuid.Nil {
		return nil, apperr.Validation("service_id and product_id are required")
	}
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	if _, err := s.getProductOrErr(ctx, productID); err != nil {
		return nil, err
	}
	n := domain.ConsumptionNorm{
		ID: ids.New(), OrganizationID: orgID, ServiceID: serviceID, ProductID: productID,
		Qty: qty, Required: required, CreatedAt: s.now().UTC(),
	}
	out, err := s.store.UpsertNorm(ctx, n)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return out, nil
}

func (s *Service) ListNorms(ctx context.Context, actor, orgID uuid.UUID, serviceID *uuid.UUID) ([]domain.ConsumptionNorm, error) {
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	items, err := s.store.ListNorms(ctx, orgID, serviceID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ConsumptionNorm{}
	}
	return items, nil
}

func (s *Service) ConsumeForAppointment(ctx context.Context, orgID, serviceID, appointmentID, actorUserID uuid.UUID) error {
	if orgID == uuid.Nil || serviceID == uuid.Nil || appointmentID == uuid.Nil {
		return apperr.Validation("organization_id, service_id and appointment_id are required")
	}
	sid := serviceID
	norms, err := s.store.ListNorms(ctx, orgID, &sid)
	if err != nil {
		return apperr.Internal(err)
	}
	if len(norms) == 0 {
		return nil
	}
	exists, err := s.store.HasMovementRef(ctx, "appointment", appointmentID)
	if err != nil {
		return apperr.Internal(err)
	}
	if exists {
		return nil
	}
	loc, err := s.store.ResolveConsumptionLocation(ctx, orgID)
	if err != nil {
		return apperr.Internal(err)
	}
	now := s.now().UTC()
	if err := s.store.ConsumeAppointmentNorms(ctx, loc.ID, norms, appointmentID, actorUserID, now); err != nil {
		if ae, ok := apperr.As(err); ok {
			return ae
		}
		return apperr.Internal(err)
	}
	return nil
}

// --- product categories ---

func slugify(name string) string {
	s := strings.TrimSpace(strings.ToLower(name))
	s = strings.ReplaceAll(s, " ", "-")
	if s == "" {
		return ids.New().String()[:8]
	}
	return s
}

func (s *Service) ListProductCategories(ctx context.Context) ([]domain.ProductCategory, error) {
	items, err := s.store.ListProductCategories(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ProductCategory{}
	}
	return items, nil
}

func (s *Service) CreateProductCategory(ctx context.Context, claims *auth.Claims, name, slug string) (*domain.ProductCategory, error) {
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
	c := domain.ProductCategory{ID: ids.New(), Name: name, Slug: slug, CreatedAt: now}
	out, err := s.store.CreateProductCategory(ctx, c)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return out, nil
}

func (s *Service) UpdateProductCategory(ctx context.Context, claims *auth.Claims, id uuid.UUID, name, slug string) (*domain.ProductCategory, error) {
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
	c := domain.ProductCategory{ID: id, Name: name, Slug: slug}
	if err := s.store.UpdateProductCategory(ctx, c); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return &c, nil
}

func (s *Service) DeleteProductCategory(ctx context.Context, claims *auth.Claims, id uuid.UUID) error {
	if !auth.HasRole(claims, "system_admin") {
		return apperr.Forbidden("system_admin role required")
	}
	if err := s.store.DeleteProductCategory(ctx, id); err != nil {
		if ae, ok := apperr.As(err); ok {
			return ae
		}
		return apperr.Internal(err)
	}
	return nil
}

// --- units of measure ---

func (s *Service) ListUnits(ctx context.Context) ([]domain.UnitOfMeasure, error) {
	items, err := s.store.ListUnits(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.UnitOfMeasure{}
	}
	return items, nil
}

func (s *Service) CreateUnit(ctx context.Context, claims *auth.Claims, code, name string) (*domain.UnitOfMeasure, error) {
	if !auth.HasRole(claims, "system_admin") {
		return nil, apperr.Forbidden("system_admin role required")
	}
	code = strings.TrimSpace(strings.ToLower(code))
	name = strings.TrimSpace(name)
	if code == "" || name == "" {
		return nil, apperr.Validation("code and name are required")
	}
	now := s.now().UTC()
	u := domain.UnitOfMeasure{ID: ids.New(), Code: code, Name: name, CreatedAt: now}
	out, err := s.store.CreateUnit(ctx, u)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return out, nil
}

func (s *Service) UpdateUnit(ctx context.Context, claims *auth.Claims, id uuid.UUID, code, name string) (*domain.UnitOfMeasure, error) {
	if !auth.HasRole(claims, "system_admin") {
		return nil, apperr.Forbidden("system_admin role required")
	}
	code = strings.TrimSpace(strings.ToLower(code))
	name = strings.TrimSpace(name)
	if code == "" || name == "" {
		return nil, apperr.Validation("code and name are required")
	}
	u := domain.UnitOfMeasure{ID: id, Code: code, Name: name}
	if err := s.store.UpdateUnit(ctx, u); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return &u, nil
}

func (s *Service) DeleteUnit(ctx context.Context, claims *auth.Claims, id uuid.UUID) error {
	if !auth.HasRole(claims, "system_admin") {
		return apperr.Forbidden("system_admin role required")
	}
	if err := s.store.DeleteUnit(ctx, id); err != nil {
		if ae, ok := apperr.As(err); ok {
			return ae
		}
		return apperr.Internal(err)
	}
	return nil
}

// --- stock forecast ---

// StockForecastRow is one product line in a location stock forecast.
type StockForecastRow struct {
	ProductID   uuid.UUID
	ProductName string
	QtyOnHand   float64
	QtyReserved float64
	Available   float64
	MinStock    float64
	Demand      float64
	Deficit     float64
	Explanation string
}

func (s *Service) StockForecast(ctx context.Context, actor, locationID uuid.UUID, from, to time.Time) ([]StockForecastRow, error) {
	if !to.After(from) {
		return nil, apperr.Validation("to must be after from")
	}
	loc, err := s.getLocationOrErr(ctx, locationID)
	if err != nil {
		return nil, err
	}
	if err := s.requireAnyMembership(ctx, loc.OrganizationID, actor); err != nil {
		return nil, err
	}
	balances, err := s.store.ListBalancesByLocation(ctx, locationID)
	if err != nil {
		return nil, apperr.Internal(err)
	}

	demand := make(map[uuid.UUID]float64)
	demandNote := "demand=0 (BOOKING_URL/INTERNAL_TOKEN not configured)"
	if s.bookingURL != "" && s.internalToken != "" {
		appointments, err := s.fetchOrgAppointments(ctx, loc.OrganizationID, from, to)
		if err != nil {
			return nil, err
		}
		norms, err := s.store.ListNorms(ctx, loc.OrganizationID, nil)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		normsByService := make(map[uuid.UUID][]domain.ConsumptionNorm)
		for _, n := range norms {
			normsByService[n.ServiceID] = append(normsByService[n.ServiceID], n)
		}
		for _, apt := range appointments {
			for _, n := range normsByService[apt.ServiceID] {
				demand[n.ProductID] += n.Qty
			}
		}
		demandNote = fmt.Sprintf("demand=sum(consumption_norm.qty per confirmed/in_progress appointment in [%s..%s])", from.Format(time.RFC3339), to.Format(time.RFC3339))
	}

	balanceByProduct := make(map[uuid.UUID]domain.StockBalanceView, len(balances))
	for _, b := range balances {
		balanceByProduct[b.ProductID] = b
	}

	productIDs := make(map[uuid.UUID]struct{}, len(balances)+len(demand))
	for pid := range balanceByProduct {
		productIDs[pid] = struct{}{}
	}
	for pid := range demand {
		productIDs[pid] = struct{}{}
	}

	rows := make([]StockForecastRow, 0, len(productIDs))
	for pid := range productIDs {
		b, hasBalance := balanceByProduct[pid]
		d := demand[pid]
		var onHand, reserved, minStock float64
		var name string
		if hasBalance {
			onHand = b.QtyOnHand
			reserved = b.QtyReserved
			minStock = b.MinStock
			name = b.ProductName
		} else {
			p, err := s.store.GetProduct(ctx, pid)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			if p != nil {
				name = p.Name
				minStock = p.MinStock
			}
		}
		available := onHand - reserved
		deficit := d + minStock - available
		if deficit < 0 {
			deficit = 0
		}
		explanation := fmt.Sprintf(
			"available=%.3f (on_hand=%.3f - reserved=%.3f); %s; deficit=max(0, demand(%.3f)+min_stock(%.3f)-available)=%.3f",
			available, onHand, reserved, demandNote, d, minStock, deficit,
		)
		rows = append(rows, StockForecastRow{
			ProductID: pid, ProductName: name,
			QtyOnHand: onHand, QtyReserved: reserved, Available: available,
			MinStock: minStock, Demand: d, Deficit: deficit, Explanation: explanation,
		})
	}
	if rows == nil {
		rows = []StockForecastRow{}
	}
	return rows, nil
}

type bookingAppointment struct {
	ServiceID uuid.UUID
}

func (s *Service) fetchOrgAppointments(ctx context.Context, orgID uuid.UUID, from, to time.Time) ([]bookingAppointment, error) {
	q := url.Values{}
	q.Set("organization_id", orgID.String())
	q.Set("from", from.UTC().Format(time.RFC3339))
	q.Set("to", to.UTC().Format(time.RFC3339))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.bookingURL+"/v1/internal/appointments?"+q.Encode(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("booking appointments status %d: %s", resp.StatusCode, string(body)))
	}
	var out struct {
		Items []struct {
			ServiceID string `json:"service_id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, apperr.Internal(err)
	}
	items := make([]bookingAppointment, 0, len(out.Items))
	for _, it := range out.Items {
		sid, err := uuid.Parse(it.ServiceID)
		if err != nil {
			continue
		}
		items = append(items, bookingAppointment{ServiceID: sid})
	}
	return items, nil
}

// --- supplier dashboard ---

type DashboardMetrics struct {
	TurnoverMinor      int64
	OrdersCount        int64
	ProductsCount      int64
	CriticalStockCount int64
}

type DashboardResult struct {
	OrganizationID uuid.UUID
	From           time.Time
	To             time.Time
	Current        DashboardMetrics
	Previous       *DashboardMetrics
}

func (s *Service) SupplierDashboard(ctx context.Context, actor, orgID uuid.UUID, from, to time.Time) (*DashboardResult, error) {
	if !to.After(from) {
		return nil, apperr.Validation("to must be after from")
	}
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	turnover, err := s.store.TurnoverInRange(ctx, orgID, from, to)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	ordersCount, err := s.store.CountOrdersInRange(ctx, orgID, from, to)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	productsCount, err := s.store.CountProducts(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	criticalCount, err := s.store.CountCriticalSupplierStock(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	res := &DashboardResult{
		OrganizationID: orgID, From: from, To: to,
		Current: DashboardMetrics{
			TurnoverMinor: turnover, OrdersCount: ordersCount, ProductsCount: productsCount, CriticalStockCount: criticalCount,
		},
	}
	duration := to.Sub(from)
	prevFrom := from.Add(-duration)
	prevTo := from
	prevTurnover, err := s.store.TurnoverInRange(ctx, orgID, prevFrom, prevTo)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	prevOrders, err := s.store.CountOrdersInRange(ctx, orgID, prevFrom, prevTo)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	res.Previous = &DashboardMetrics{TurnoverMinor: prevTurnover, OrdersCount: prevOrders}
	return res, nil
}

// --- supplier orders ---

type OrderItemInput struct {
	ProductID  uuid.UUID
	QtyOrdered float64
}

type CreateOrderInput struct {
	BuyerOrgID          uuid.UUID
	SupplierOrgID       uuid.UUID
	LocationID          uuid.UUID
	DestinationBranchID uuid.UUID
	PaymentMethod       string
	DeliveryCostMinor   int64
	IdempotencyKey      string
	Comment             string
	DesiredAt           *time.Time
	Items               []OrderItemInput
}

func (s *Service) CreateSupplierOrder(ctx context.Context, actor uuid.UUID, in CreateOrderInput) (*domain.SupplierOrder, []domain.SupplierOrderItem, error) {
	if in.SupplierOrgID == uuid.Nil {
		return nil, nil, apperr.Validation("supplier_org_id is required")
	}
	if len(in.Items) == 0 {
		return nil, nil, apperr.Validation("at least one item is required")
	}
	if in.DeliveryCostMinor < 0 {
		return nil, nil, apperr.Validation("delivery_cost_minor must not be negative")
	}
	idemKey := strings.TrimSpace(in.IdempotencyKey)
	if idemKey != "" {
		existing, err := s.store.GetOrderByIdempotencyKey(ctx, actor, idemKey)
		if err != nil {
			return nil, nil, apperr.Internal(err)
		}
		if existing != nil {
			items, err := s.OrderItems(ctx, existing.ID)
			if err != nil {
				return nil, nil, err
			}
			return existing, items, nil
		}
	}

	loc, err := s.getLocationOrErr(ctx, in.LocationID)
	if err != nil {
		return nil, nil, err
	}
	if loc.OrganizationID != in.BuyerOrgID {
		return nil, nil, apperr.Validation("location does not belong to buyer organization")
	}
	if err := s.requireMembership(ctx, in.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
		return nil, nil, err
	}

	paymentMethod := domain.NormalizePaymentMethod(in.PaymentMethod)
	if !domain.ValidPaymentMethod(paymentMethod) {
		return nil, nil, apperr.Validation("invalid payment_method")
	}

	var destBranchID *uuid.UUID
	if in.DestinationBranchID != uuid.Nil {
		if err := s.validateDestinationBranch(ctx, in.DestinationBranchID); err != nil {
			return nil, nil, err
		}
		id := in.DestinationBranchID
		destBranchID = &id
	}

	built, err := buildOrderItems(in.SupplierOrgID, in.Items, func(productID uuid.UUID) (*domain.Product, error) {
		return s.getProductOrErr(ctx, productID)
	})
	if err != nil {
		return nil, nil, err
	}

	now := s.now().UTC()
	order := domain.SupplierOrder{
		ID: ids.New(), BuyerOrgID: in.BuyerOrgID, SupplierOrgID: in.SupplierOrgID, LocationID: in.LocationID,
		DestinationBranchID: destBranchID,
		Status:              domain.OrderStatusNew, Currency: "RUB",
		TotalMinor: domain.OrderTotalMinor(built.SubtotalMinor, in.DeliveryCostMinor),
		SubtotalMinor: built.SubtotalMinor, DeliveryCostMinor: in.DeliveryCostMinor,
		PaymentMethod: paymentMethod, PaymentStatus: domain.InitialPaymentStatus(paymentMethod),
		IdempotencyKey: idemKey, Comment: strings.TrimSpace(in.Comment),
		DesiredAt: in.DesiredAt, CreatedBy: actor, CreatedAt: now, UpdatedAt: now,
	}

	var delivery *domain.OrderDelivery
	if destBranchID != nil {
		delivery = &domain.OrderDelivery{
			ID: ids.New(), OrderID: order.ID, SupplierOrgID: in.SupplierOrgID,
			DestinationBranchID: *destBranchID, Status: domain.DeliveryStatusPending,
			CreatedAt: now, UpdatedAt: now,
		}
	}

	outOrder, outItems, _, err := s.store.CreateOrder(ctx, order, built.Items, delivery)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if err := s.reserveOrderStock(ctx, actor, outOrder, outItems); err != nil {
		return nil, nil, err
	}
	return outOrder, outItems, nil
}

type builtOrderItems struct {
	Items         []domain.SupplierOrderItem
	SubtotalMinor int64
}

// buildOrderItems validates products and snapshots prices/names using int64 line totals.
func buildOrderItems(supplierOrgID uuid.UUID, inputs []OrderItemInput, loadProduct func(uuid.UUID) (*domain.Product, error)) (*builtOrderItems, error) {
	items := make([]domain.SupplierOrderItem, 0, len(inputs))
	var subtotal int64
	for _, it := range inputs {
		if it.ProductID == uuid.Nil {
			return nil, apperr.Validation("item product_id is required")
		}
		if it.QtyOrdered <= 0 {
			return nil, apperr.Validation("item qty must be positive")
		}
		p, err := loadProduct(it.ProductID)
		if err != nil {
			return nil, err
		}
		if !domain.ProductEligibleForOrder(p.Published, p.ForSale, p.OrganizationID, supplierOrgID) {
			if p.OrganizationID != supplierOrgID {
				return nil, apperr.Validation("product does not belong to supplier")
			}
			return nil, apperr.Validation("product must be published and for_sale")
		}
		subtotal += domain.LineTotalMinor(it.QtyOrdered, p.PriceMinor)
		items = append(items, domain.SupplierOrderItem{
			ID: ids.New(), ProductID: it.ProductID, QtyOrdered: it.QtyOrdered,
			PriceMinor: p.PriceMinor, ProductName: p.Name, ProductSKU: p.SKU,
		})
	}
	return &builtOrderItems{Items: items, SubtotalMinor: subtotal}, nil
}

func (s *Service) validateDestinationBranch(ctx context.Context, branchID uuid.UUID) error {
	if s.organizationsURL == "" {
		// Soft validation when orgs service is not wired.
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.organizationsURL+"/v1/branches/"+branchID.String(), nil)
	if err != nil {
		return apperr.Internal(err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound {
		return apperr.Validation("destination_branch_id not found")
	}
	if resp.StatusCode >= 300 {
		return apperr.Internal(fmt.Errorf("branch lookup status %d: %s", resp.StatusCode, string(body)))
	}
	var out struct {
		Published     bool `json:"published"`
		PickupEnabled bool `json:"pickup_enabled"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return apperr.Internal(err)
	}
	if !out.Published || !out.PickupEnabled {
		return apperr.Validation("destination branch must be published and pickup_enabled")
	}
	return nil
}

func (s *Service) ListSupplierOrders(ctx context.Context, actor, orgID uuid.UUID, asSupplier bool) ([]domain.SupplierOrder, error) {
	if err := s.requireAnyMembership(ctx, orgID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListOrders(ctx, orgID, asSupplier)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.SupplierOrder{}
	}
	return items, nil
}

func (s *Service) getOrderOrErr(ctx context.Context, id uuid.UUID) (*domain.SupplierOrder, error) {
	o, err := s.store.GetOrder(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, apperr.NotFound("order not found")
	}
	return o, nil
}

// OrderItems returns the line items for an order. Callers are expected to
// have already authorized access to the order's buyer or supplier org.
func (s *Service) OrderItems(ctx context.Context, orderID uuid.UUID) ([]domain.SupplierOrderItem, error) {
	items, err := s.store.ListOrderItems(ctx, orderID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.SupplierOrderItem{}
	}
	return items, nil
}

func (s *Service) GetSupplierOrder(ctx context.Context, actor, orderID uuid.UUID) (*domain.SupplierOrder, []domain.SupplierOrderItem, error) {
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.requireOrderAccess(ctx, actor, o); err != nil {
		return nil, nil, err
	}
	items, err := s.OrderItems(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	return o, items, nil
}

func (s *Service) requireOrderAccess(ctx context.Context, actor uuid.UUID, o *domain.SupplierOrder) error {
	if err := s.requireAnyMembership(ctx, o.BuyerOrgID, actor); err == nil {
		return nil
	}
	return s.requireAnyMembership(ctx, o.SupplierOrgID, actor)
}

func (s *Service) TransitionSupplierOrder(ctx context.Context, actor, orderID uuid.UUID, toStatus string, estimatedDeliveryAt *time.Time) (*domain.SupplierOrder, error) {
	toStatus = strings.TrimSpace(toStatus)
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if !domain.CanTransitionOrder(o.Status, toStatus) {
		return nil, apperr.Conflict("invalid status transition from " + o.Status + " to " + toStatus)
	}
	switch toStatus {
	case domain.OrderStatusCancelled:
		if err := s.requireMembership(ctx, o.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
			return nil, err
		}
	default:
		if err := s.requireMembership(ctx, o.SupplierOrgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
	}
	now := s.now().UTC()
	if toStatus == domain.OrderStatusCancelled {
		if err := s.releaseOrderStock(ctx, actor, o); err != nil {
			return nil, err
		}
	}
	if err := s.store.UpdateOrderStatus(ctx, orderID, toStatus, now, estimatedDeliveryAt); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	o.Status = toStatus
	o.UpdatedAt = now
	if estimatedDeliveryAt != nil {
		o.EstimatedDeliveryAt = estimatedDeliveryAt
	}
	if domain.ShouldPrepareDeliveryOnOrderTransition(toStatus) {
		_ = s.maybePrepareDelivery(ctx, o, now)
	}
	return o, nil
}

func (s *Service) maybePrepareDelivery(ctx context.Context, o *domain.SupplierOrder, now time.Time) error {
	d, err := s.store.GetDeliveryByOrderID(ctx, o.ID)
	if err != nil || d == nil {
		return err
	}
	if d.Status != domain.DeliveryStatusPending && d.Status != domain.DeliveryStatusScheduled {
		return nil
	}
	if !domain.CanTransitionDelivery(d.Status, domain.DeliveryStatusPreparing) {
		return nil
	}
	d.Status = domain.DeliveryStatusPreparing
	d.UpdatedAt = now
	return s.store.UpdateDelivery(ctx, *d)
}

func (s *Service) ConfirmSupplierOrder(ctx context.Context, actor, orderID uuid.UUID) (*domain.SupplierOrder, error) {
	return s.TransitionSupplierOrder(ctx, actor, orderID, domain.OrderStatusConfirmed, nil)
}

func (s *Service) MarkSupplierOrderPaid(ctx context.Context, actor, orderID uuid.UUID) (*domain.SupplierOrder, error) {
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if err := s.requireMembership(ctx, o.SupplierOrgID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	if o.Status == domain.OrderStatusCancelled {
		return nil, apperr.Conflict("cannot mark paid a cancelled order")
	}
	if o.PaymentStatus == domain.PaymentStatusPaid {
		return o, nil
	}
	now := s.now().UTC()
	if err := s.store.MarkOrderPaid(ctx, orderID, now, now); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	o.PaymentStatus = domain.PaymentStatusPaid
	o.PaidAt = &now
	o.UpdatedAt = now
	return o, nil
}

// --- deliveries ---

type ScheduleDeliveryInput struct {
	WindowStart       *time.Time
	WindowEnd         *time.Time
	PlannedDeliveryAt *time.Time
	RecipientName     string
	RecipientPhone    string
	Comment           string
	Provider          string
	TrackingCode      string
}

func (s *Service) GetOrderDelivery(ctx context.Context, actor, orderID uuid.UUID) (*domain.OrderDelivery, error) {
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if err := s.requireOrderAccess(ctx, actor, o); err != nil {
		return nil, err
	}
	d, err := s.store.GetDeliveryByOrderID(ctx, orderID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if d == nil {
		return nil, apperr.NotFound("delivery not found")
	}
	return d, nil
}

func (s *Service) ScheduleOrderDelivery(ctx context.Context, actor, orderID uuid.UUID, in ScheduleDeliveryInput) (*domain.OrderDelivery, error) {
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if err := s.requireMembership(ctx, o.SupplierOrgID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	if o.Status == domain.OrderStatusCancelled {
		return nil, apperr.Conflict("cannot schedule delivery for cancelled order")
	}
	d, err := s.store.GetDeliveryByOrderID(ctx, orderID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if d == nil {
		return nil, apperr.NotFound("delivery not found")
	}
	if d.Status != domain.DeliveryStatusPending && d.Status != domain.DeliveryStatusScheduled {
		return nil, apperr.Conflict("delivery can only be scheduled from pending/scheduled")
	}
	if in.WindowStart != nil && in.WindowEnd != nil && !in.WindowEnd.After(*in.WindowStart) {
		return nil, apperr.Validation("window_end must be after window_start")
	}
	now := s.now().UTC()
	d.Status = domain.DeliveryStatusScheduled
	d.WindowStart = in.WindowStart
	d.WindowEnd = in.WindowEnd
	d.PlannedDeliveryAt = in.PlannedDeliveryAt
	if name := strings.TrimSpace(in.RecipientName); name != "" {
		d.RecipientName = name
	}
	if phone := strings.TrimSpace(in.RecipientPhone); phone != "" {
		d.RecipientPhone = phone
	}
	if c := strings.TrimSpace(in.Comment); c != "" {
		d.Comment = c
	}
	if p := strings.TrimSpace(in.Provider); p != "" {
		d.Provider = p
	}
	if t := strings.TrimSpace(in.TrackingCode); t != "" {
		d.TrackingCode = t
	}
	d.UpdatedAt = now
	if err := s.store.UpdateDelivery(ctx, *d); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return d, nil
}

func (s *Service) TransitionOrderDelivery(ctx context.Context, actor, orderID uuid.UUID, toStatus string) (*domain.OrderDelivery, error) {
	toStatus = strings.TrimSpace(toStatus)
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if err := s.requireMembership(ctx, o.SupplierOrgID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	if o.Status == domain.OrderStatusCancelled {
		return nil, apperr.Conflict("cannot transition delivery for cancelled order")
	}
	d, err := s.store.GetDeliveryByOrderID(ctx, orderID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if d == nil {
		return nil, apperr.NotFound("delivery not found")
	}

	switch toStatus {
	case domain.DeliveryStatusInTransit:
		if !domain.OrderAllowsInTransitDelivery(o.Status) {
			return nil, apperr.Conflict("order status does not allow in_transit delivery")
		}
	case domain.DeliveryStatusDelivered:
		if !domain.CanMarkDeliveryDelivered(d.Status) {
			return nil, apperr.Conflict("delivery must be in_transit or arrived before delivered")
		}
	}

	if !domain.CanTransitionDelivery(d.Status, toStatus) {
		return nil, apperr.Conflict("invalid delivery transition from " + d.Status + " to " + toStatus)
	}

	now := s.now().UTC()
	if toStatus == domain.DeliveryStatusDelivered {
		if err := s.store.CompleteDelivery(ctx, d.ID, o.ID, now, now); err != nil {
			if ae, ok := apperr.As(err); ok {
				return nil, ae
			}
			return nil, apperr.Internal(err)
		}
		d.Status = domain.DeliveryStatusDelivered
		d.DeliveredAt = &now
		d.UpdatedAt = now
		_ = s.shipOrderStock(ctx, actor, o)
		return d, nil
	}

	d.Status = toStatus
	d.UpdatedAt = now
	if err := s.store.UpdateDelivery(ctx, *d); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return d, nil
}

var acceptableAcceptStatuses = map[string]bool{
	domain.OrderStatusDelivered:       true,
	domain.OrderStatusCompleted:       true,
	domain.OrderStatusAcceptedPartial: true,
}

type AcceptItemInput struct {
	ProductID   uuid.UUID
	QtyAccepted float64
	QtyDamaged  float64
	QtyRejected float64
}

func (s *Service) AcceptSupplierOrder(ctx context.Context, actor, orderID uuid.UUID, accepted []AcceptItemInput) (*domain.SupplierOrder, []domain.SupplierOrderItem, error) {
	if len(accepted) == 0 {
		return nil, nil, apperr.Validation("at least one item is required")
	}
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.requireMembership(ctx, o.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
		return nil, nil, err
	}
	if !acceptableAcceptStatuses[o.Status] {
		return nil, nil, apperr.Conflict("order is not ready to be accepted")
	}
	items := make([]store.AcceptItem, 0, len(accepted))
	for _, it := range accepted {
		if it.ProductID == uuid.Nil {
			return nil, nil, apperr.Validation("product_id is required")
		}
		if it.QtyAccepted <= 0 {
			return nil, nil, apperr.Validation("qty_accepted must be positive")
		}
		if it.QtyDamaged < 0 || it.QtyRejected < 0 {
			return nil, nil, apperr.Validation("qty_damaged and qty_rejected must not be negative")
		}
		items = append(items, store.AcceptItem{ProductID: it.ProductID, QtyDiff: it.QtyAccepted})
	}
	outOrder, outItems, err := s.store.AcceptOrder(ctx, orderID, actor, items, s.now().UTC())
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, nil, ae
		}
		return nil, nil, apperr.Internal(err)
	}
	return outOrder, outItems, nil
}
