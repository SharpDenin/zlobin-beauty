package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerKnowledgeRoutes(mux *http.ServeMux, authMw, optional func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/knowledge", optional(http.HandlerFunc(a.listKnowledge)))
	mux.Handle("GET /v1/knowledge/facets", optional(http.HandlerFunc(a.knowledgeFacets)))
	mux.Handle("GET /v1/knowledge/{id}", optional(http.HandlerFunc(a.getKnowledge)))
	mux.Handle("POST /v1/knowledge", authMw(http.HandlerFunc(a.createKnowledge)))
	mux.Handle("PUT /v1/knowledge/{id}", authMw(http.HandlerFunc(a.updateKnowledge)))
	mux.Handle("POST /v1/knowledge/{id}/publish", authMw(http.HandlerFunc(a.publishKnowledge)))
	mux.Handle("POST /v1/knowledge/{id}/unpublish", authMw(http.HandlerFunc(a.unpublishKnowledge)))
	mux.Handle("POST /v1/knowledge/{id}/archive", authMw(http.HandlerFunc(a.archiveKnowledge)))
	mux.Handle("POST /v1/knowledge/{id}/favorite", authMw(http.HandlerFunc(a.addKnowledgeFavorite)))
	mux.Handle("DELETE /v1/knowledge/{id}/favorite", authMw(http.HandlerFunc(a.removeKnowledgeFavorite)))
	mux.Handle("GET /v1/me/knowledge/recommendations", authMw(http.HandlerFunc(a.myKnowledgeRecommendations)))
	mux.Handle("GET /v1/me/knowledge", authMw(http.HandlerFunc(a.listMyKnowledge)))
}

func knowledgeDTO(a domain.KnowledgeArticle) map[string]any {
	var orgID any
	if a.AuthorOrgID != nil {
		orgID = a.AuthorOrgID.String()
	}
	var productID any
	if a.ProductID != nil {
		productID = a.ProductID.String()
	}
	var coverMediaID any
	if a.CoverMediaID != nil {
		coverMediaID = a.CoverMediaID.String()
	}
	var publishedAt any
	if a.PublishedAt != nil {
		publishedAt = *a.PublishedAt
	}
	format := a.ContentFormat
	if format == "" {
		format = "plain"
	}
	status := a.Status
	if status == "" {
		if a.Published {
			status = domain.KnowledgeStatusPublished
		} else {
			status = domain.KnowledgeStatusDraft
		}
	}
	return map[string]any{
		"id": a.ID.String(), "title": a.Title, "category": a.Category, "content": a.Content,
		"content_format": format, "cover_media_id": coverMediaID, "reading_time_minutes": a.ReadingTimeMinutes,
		"brand": a.Brand, "product_id": productID,
		"product_ids": uuidStrings(a.ProductIDs), "category_ids": uuidStrings(a.CategoryIDs),
		"author_user_id": a.AuthorUserID.String(), "author_org_id": orgID, "author_name": a.AuthorName,
		"status": status, "published": status == domain.KnowledgeStatusPublished,
		"view_count": a.ViewCount, "favorite": a.Favorite,
		"home_care": a.HomeCare, "professional": a.Professional, "audience_kind": knowledgeAudienceKind(a),
		"published_at": publishedAt, "created_at": a.CreatedAt, "updated_at": a.UpdatedAt,
	}
}

func knowledgeListDTO(a domain.KnowledgeArticle) map[string]any {
	dto := knowledgeDTO(a)
	delete(dto, "content")
	dto["excerpt"] = knowledgeExcerpt(a)
	return dto
}

func knowledgeRecommendationDTO(a domain.KnowledgeArticle, context string) map[string]any {
	var productID any
	if a.ProductID != nil {
		productID = a.ProductID.String()
	}
	return map[string]any{
		"id":          a.ID.String(),
		"article_id":  a.ID.String(),
		"title":       a.Title,
		"excerpt":     knowledgeExcerpt(a),
		"category":    a.Category,
		"context":     context,
		"product_id":  productID,
		"product_ids": uuidStrings(a.ProductIDs),
	}
}

func knowledgeAudienceKind(a domain.KnowledgeArticle) string {
	if a.AudienceKind != "" {
		return a.AudienceKind
	}
	if a.HomeCare && a.Professional {
		return service.AudienceKindMixed
	}
	if a.HomeCare {
		return service.AudienceKindHome
	}
	return service.AudienceKindProfessional
}

func knowledgeHomeCareOnly(r *http.Request) bool {
	claims, ok := httpx.ClaimsFrom(r.Context())
	if !ok {
		return true
	}
	return !auth.HasProfessionalRole(claims)
}

func knowledgeExcerpt(a domain.KnowledgeArticle) string {
	raw := a.Content
	if a.ContentFormat == "doc_json" {
		raw = extractPlainFromDoc(a.Content)
	}
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\n", " "))
	runes := []rune(raw)
	if len(runes) > 140 {
		return string(runes[:140]) + "…"
	}
	return raw
}

func extractPlainFromDoc(content string) string {
	var node map[string]any
	if err := json.Unmarshal([]byte(content), &node); err != nil {
		return content
	}
	var b strings.Builder
	var walk func(map[string]any)
	walk = func(n map[string]any) {
		if t, ok := n["text"].(string); ok {
			b.WriteString(t)
			b.WriteByte(' ')
		}
		if kids, ok := n["content"].([]any); ok {
			for _, c := range kids {
				if m, ok := c.(map[string]any); ok {
					walk(m)
				}
			}
		}
	}
	walk(node)
	return b.String()
}

func (a *API) listKnowledge(w http.ResponseWriter, r *http.Request) {
	q, err := parseKnowledgeListQuery(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	q.PublishedOnly = true
	q.HomeCareOnly = knowledgeHomeCareOnly(r)
	if claims, ok := httpx.ClaimsFrom(r.Context()); ok {
		q.ViewerID = &claims.UserID
	}
	res, err := a.svc.ListKnowledge(r.Context(), q)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(res.Items))
	for _, item := range res.Items {
		out = append(out, knowledgeListDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": res.Total, "limit": res.Limit, "offset": res.Offset})
}

func (a *API) listMyKnowledge(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	q, err := parseKnowledgeListQuery(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	itemsRes, err := a.svc.ListMyKnowledge(r.Context(), claims.UserID, q)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(itemsRes.Items))
	for _, item := range itemsRes.Items {
		out = append(out, knowledgeListDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": itemsRes.Total, "limit": itemsRes.Limit, "offset": itemsRes.Offset})
}

func (a *API) myKnowledgeRecommendations(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	values := r.URL.Query()
	products, err := parseRepeatUUIDs(values, "product_id")
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
		return
	}
	serviceID, err := parseQueryUUID(values.Get("service_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid service_id"))
		return
	}
	orgID, err := parseQueryUUID(values.Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
		return
	}
	appointmentID, err := parseQueryUUID(values.Get("appointment_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid appointment_id"))
		return
	}
	in := service.KnowledgeRecommendInput{
		ViewerID:     claims.UserID,
		AccessToken:  strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")),
		HomeCareOnly: !auth.HasProfessionalRole(claims),
		ProductIDs:   products,
		Query:        values.Get("q"),
	}
	if serviceID != nil {
		in.ServiceID = *serviceID
	}
	if orgID != nil {
		in.OrganizationID = *orgID
	}
	if appointmentID != nil {
		in.AppointmentID = *appointmentID
	}
	res, err := a.svc.RecommendKnowledge(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items := make([]map[string]any, 0, len(res.Items))
	for _, it := range res.Items {
		items = append(items, knowledgeRecommendationDTO(it.Article, it.Context))
	}
	out := map[string]any{"items": items}
	if res.ServiceID != uuid.Nil {
		out["service_id"] = res.ServiceID.String()
	}
	if res.EmptyReason != "" {
		out["empty_reason"] = res.EmptyReason
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *API) knowledgeFacets(w http.ResponseWriter, r *http.Request) {
	f, err := a.svc.KnowledgeFacets(r.Context(), knowledgeHomeCareOnly(r))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	mapFacets := func(items []store.KnowledgeFacet) []map[string]any {
		out := make([]map[string]any, 0, len(items))
		for _, it := range items {
			out = append(out, map[string]any{"value": it.Value, "label": it.Label, "count": it.Count})
		}
		return out
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"categories": mapFacets(f.Categories),
		"brands":     mapFacets(f.Brands),
		"suppliers":  mapFacets(f.Suppliers),
	})
}

func (a *API) getKnowledge(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var viewerID *uuid.UUID
	if claims, ok := httpx.ClaimsFrom(r.Context()); ok {
		viewerID = &claims.UserID
	}
	item, err := a.svc.GetKnowledge(r.Context(), id, viewerID, knowledgeHomeCareOnly(r))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, knowledgeDTO(*item))
}

func (a *API) createKnowledge(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	if !auth.HasRole(claims, "supplier") {
		httpx.WriteError(w, r, a.log, apperr.Forbidden("supplier role required"))
		return
	}
	in, err := decodeKnowledgeWrite(r, false)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	in.ActorUserID = claims.UserID
	item, err := a.svc.CreateKnowledge(r.Context(), claims, in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, knowledgeDTO(*item))
}

func (a *API) updateKnowledge(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	in, err := decodeKnowledgeWrite(r, true)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	in.ActorUserID = claims.UserID
	item, err := a.svc.UpdateKnowledge(r.Context(), claims.UserID, id, in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, knowledgeDTO(*item))
}

func (a *API) publishKnowledge(w http.ResponseWriter, r *http.Request) {
	a.setKnowledgeStatus(w, r, domain.KnowledgeStatusPublished)
}

func (a *API) unpublishKnowledge(w http.ResponseWriter, r *http.Request) {
	a.setKnowledgeStatus(w, r, domain.KnowledgeStatusDraft)
}

func (a *API) archiveKnowledge(w http.ResponseWriter, r *http.Request) {
	a.setKnowledgeStatus(w, r, domain.KnowledgeStatusArchived)
}

func (a *API) setKnowledgeStatus(w http.ResponseWriter, r *http.Request, status string) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.SetKnowledgeStatus(r.Context(), claims.UserID, id, status)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, knowledgeDTO(*item))
}

func (a *API) addKnowledgeFavorite(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.AddKnowledgeFavorite(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, knowledgeDTO(*item))
}

func (a *API) removeKnowledgeFavorite(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.RemoveKnowledgeFavorite(r.Context(), claims.UserID, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseKnowledgeListQuery(r *http.Request) (service.KnowledgeListQuery, error) {
	values := r.URL.Query()
	q := service.KnowledgeListQuery{
		Query: values.Get("q"),
		Sort:  values.Get("sort"),
	}
	if cats := collectQueryValues(values["category"]); len(cats) > 0 {
		q.Categories = cats
	}
	if brands := collectQueryValues(values["brand"]); len(brands) > 0 {
		q.Brands = brands
	}
	suppliers, err := parseRepeatUUIDs(values, "supplier", "supplier_id")
	if err != nil {
		return q, apperr.Validation("invalid supplier")
	}
	q.SupplierOrgIDs = suppliers
	products, err := parseRepeatUUIDs(values, "product_id")
	if err != nil {
		return q, apperr.Validation("invalid product_id")
	}
	q.ProductIDs = products
	catIDs, err := parseRepeatUUIDs(values, "product_category_id")
	if err != nil {
		return q, apperr.Validation("invalid product_category_id")
	}
	q.ProductCategoryIDs = catIDs
	exclude, err := parseQueryUUID(values.Get("exclude_id"))
	if err != nil {
		return q, apperr.Validation("invalid exclude_id")
	}
	q.ExcludeID = exclude
	fav := strings.TrimSpace(strings.ToLower(values.Get("favorites")))
	q.FavoritesOnly = fav == "1" || fav == "true" || fav == "yes"
	if lim := strings.TrimSpace(values.Get("limit")); lim != "" {
		n, err := strconv.Atoi(lim)
		if err != nil || n < 0 {
			return q, apperr.Validation("invalid limit")
		}
		q.Limit = n
	}
	if off := strings.TrimSpace(values.Get("offset")); off != "" {
		n, err := strconv.Atoi(off)
		if err != nil || n < 0 {
			return q, apperr.Validation("invalid offset")
		}
		q.Offset = n
	}
	if page := strings.TrimSpace(values.Get("page")); page != "" && q.Offset == 0 {
		n, err := strconv.Atoi(page)
		if err != nil || n < 1 {
			return q, apperr.Validation("invalid page")
		}
		lim := q.Limit
		if lim <= 0 {
			lim = 24
		}
		q.Offset = (n - 1) * lim
	}
	return q, nil
}

func collectQueryValues(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

func parseRepeatUUIDs(values map[string][]string, keys ...string) ([]uuid.UUID, error) {
	var raw []string
	for _, k := range keys {
		raw = append(raw, values[k]...)
	}
	return parseUUIDList(collectQueryValues(raw), keys[0])
}

func decodeKnowledgeWrite(r *http.Request, isUpdate bool) (service.KnowledgeInput, error) {
	var req struct {
		Title              string    `json:"title"`
		Category           string    `json:"category"`
		Content            string    `json:"content"`
		ContentFormat      string    `json:"content_format"`
		CoverMediaID       *string   `json:"cover_media_id"`
		ReadingTimeMinutes int       `json:"reading_time_minutes"`
		Brand              string    `json:"brand"`
		ProductID          *string   `json:"product_id"`
		ProductIDs         *[]string `json:"product_ids"`
		ProductCategoryIDs *[]string `json:"product_category_ids"`
		CategoryIDs        *[]string `json:"category_ids"`
		AuthorName         string    `json:"author_name"`
		OrgID              *string   `json:"organization_id"`
		Published          *bool     `json:"published"`
		Status             *string   `json:"status"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return service.KnowledgeInput{}, apperr.Validation("invalid json body")
	}
	var orgID *uuid.UUID
	if req.OrgID != nil && *req.OrgID != "" {
		parsed, err := uuid.Parse(*req.OrgID)
		if err != nil {
			return service.KnowledgeInput{}, apperr.Validation("invalid organization_id")
		}
		orgID = &parsed
	}
	productID, err := parseOptionalUUID(req.ProductID)
	if err != nil {
		return service.KnowledgeInput{}, apperr.Validation("invalid product_id")
	}
	in := service.KnowledgeInput{
		ActorName: req.AuthorName, OrgID: orgID,
		Title: req.Title, Category: req.Category, Content: req.Content, ContentFormat: req.ContentFormat,
		ReadingTimeMinutes: req.ReadingTimeMinutes, Brand: req.Brand, ProductID: productID,
		Published: req.Published,
	}
	if req.Status != nil {
		in.Status = *req.Status
	}
	if req.CoverMediaID != nil {
		if *req.CoverMediaID == "" {
			in.ClearCover = true
		} else {
			coverID, err := uuid.Parse(*req.CoverMediaID)
			if err != nil {
				return service.KnowledgeInput{}, apperr.Validation("invalid cover_media_id")
			}
			in.CoverMediaID = &coverID
		}
	}
	if req.ProductIDs != nil || req.ProductID != nil {
		in.SetProductIDs = true
		if req.ProductIDs != nil {
			ids, err := parseUUIDList(*req.ProductIDs, "product_ids")
			if err != nil {
				return service.KnowledgeInput{}, err
			}
			in.ProductIDs = ids
		}
	} else if !isUpdate {
		in.SetProductIDs = true
	}
	catSrc := req.ProductCategoryIDs
	if catSrc == nil {
		catSrc = req.CategoryIDs
	}
	if catSrc != nil {
		ids, err := parseUUIDList(*catSrc, "product_category_ids")
		if err != nil {
			return service.KnowledgeInput{}, err
		}
		in.SetCategoryIDs = true
		in.CategoryIDs = ids
	} else if !isUpdate {
		in.SetCategoryIDs = true
	}
	return in, nil
}

func parseQueryUUID(raw string) (*uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func parseUUIDList(raw []string, field string) ([]uuid.UUID, error) {
	out := make([]uuid.UUID, 0, len(raw))
	for _, s := range raw {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		id, err := uuid.Parse(s)
		if err != nil {
			return nil, apperr.Validation("invalid " + field)
		}
		out = append(out, id)
	}
	return out, nil
}

func uuidStrings(ids []uuid.UUID) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	return out
}
