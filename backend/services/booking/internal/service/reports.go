package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

type SalonPeriodMetrics struct {
	TurnoverMinor      int64
	CompletedCount     int64
	AvgCheckMinor      *int64
	RepeatVisitPercent *float64
	MasterLoadPercent  *float64
	SatisfactionAvg    *float64
	SatisfactionCount  int64
}

type MasterLoadRow struct {
	MasterUserID     uuid.UUID
	BookedMinutes    int64
	AvailableMinutes int64
	LoadPercent      *float64
}

type SalonReportDeltas struct {
	TurnoverPercent       *float64
	CompletedCountPercent *float64
	AvgCheckPercent       *float64
}

type SalonReportFormulas struct {
	Turnover     string
	AvgCheck     string
	RepeatVisits string
	MasterLoad   string
	Satisfaction string
}

type SalonReportResult struct {
	OrganizationID uuid.UUID
	From           time.Time
	To             time.Time
	Current        SalonPeriodMetrics
	Previous       SalonPeriodMetrics
	Deltas         SalonReportDeltas
	Masters        []MasterLoadRow
	Formulas       SalonReportFormulas
}

var salonReportFormulas = SalonReportFormulas{
	Turnover:     "sum(price_minor) of completed appointments; returns=0 until modeled",
	AvgCheck:     "turnover / completed_count",
	RepeatVisits: "clients with >=2 completed / clients with >=1 completed * 100",
	MasterLoad:   "booked_minutes / available_working_minutes * 100",
	Satisfaction: "avg((master_rating+result_rating)/2) published reviews",
}

func (s *Service) SalonReport(ctx context.Context, actor, orgID uuid.UUID, from, to time.Time) (*SalonReportResult, error) {
	if orgID == uuid.Nil {
		return nil, apperr.Validation("organization_id is required")
	}
	if !to.After(from) {
		return nil, apperr.Validation("to must be after from")
	}
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	from = from.UTC()
	to = to.UTC()

	curr, masters, err := s.salonPeriodMetrics(ctx, orgID, from, to)
	if err != nil {
		return nil, err
	}
	duration := to.Sub(from)
	prevFrom := from.Add(-duration)
	prevTo := from
	prev, _, err := s.salonPeriodMetrics(ctx, orgID, prevFrom, prevTo)
	if err != nil {
		return nil, err
	}

	return &SalonReportResult{
		OrganizationID: orgID,
		From:           from,
		To:             to,
		Current:        curr,
		Previous:       prev,
		Deltas:         salonDeltas(curr, prev),
		Masters:        masters,
		Formulas:       salonReportFormulas,
	}, nil
}

func (s *Service) salonPeriodMetrics(ctx context.Context, orgID uuid.UUID, from, to time.Time) (SalonPeriodMetrics, []MasterLoadRow, error) {
	stats, err := s.store.CompletedStatsInRange(ctx, orgID, from, to)
	if err != nil {
		return SalonPeriodMetrics{}, nil, apperr.Internal(err)
	}
	metrics := SalonPeriodMetrics{
		TurnoverMinor:  stats.TurnoverMinor,
		CompletedCount: stats.CompletedCount,
	}
	if stats.CompletedCount > 0 {
		avg := stats.TurnoverMinor / stats.CompletedCount
		metrics.AvgCheckMinor = &avg
	}
	if stats.ClientsWithOne > 0 {
		pct := float64(stats.ClientsWithTwo) / float64(stats.ClientsWithOne) * 100
		metrics.RepeatVisitPercent = &pct
	}

	masters, orgLoad, err := s.masterLoadReport(ctx, orgID, from, to)
	if err != nil {
		return SalonPeriodMetrics{}, nil, err
	}
	metrics.MasterLoadPercent = orgLoad

	masterIDs, err := s.store.CompletedMasterUserIDs(ctx, orgID, from, to)
	if err != nil {
		return SalonPeriodMetrics{}, nil, apperr.Internal(err)
	}
	avg, count, err := s.fetchReviewStats(ctx, masterIDs, from, to)
	if err != nil {
		return SalonPeriodMetrics{}, nil, err
	}
	metrics.SatisfactionAvg = avg
	metrics.SatisfactionCount = count

	return metrics, masters, nil
}

func (s *Service) masterLoadReport(ctx context.Context, orgID uuid.UUID, from, to time.Time) ([]MasterLoadRow, *float64, error) {
	masterIDs, err := s.store.MastersForLoadReport(ctx, orgID, from, to)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	bookedRows, err := s.store.MasterBookedMinutesInRange(ctx, orgID, from, to)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	bookedByMaster := map[uuid.UUID]int64{}
	for _, row := range bookedRows {
		bookedByMaster[row.MasterUserID] = row.BookedMinutes
	}

	var masters []MasterLoadRow
	var loadSum float64
	var loadCount int
	for _, masterID := range masterIDs {
		hours, err := s.store.ListWorkingHours(ctx, masterID)
		if err != nil {
			return nil, nil, apperr.Internal(err)
		}
		available := availableMinutesFromHours(hours, from, to)
		booked := bookedByMaster[masterID]
		row := MasterLoadRow{
			MasterUserID:     masterID,
			BookedMinutes:    booked,
			AvailableMinutes: int64(available),
		}
		if available > 0 {
			pct := float64(booked) / float64(available) * 100
			row.LoadPercent = &pct
			loadSum += pct
			loadCount++
		}
		masters = append(masters, row)
	}
	if masters == nil {
		masters = []MasterLoadRow{}
	}
	var orgLoad *float64
	if loadCount > 0 {
		avg := loadSum / float64(loadCount)
		orgLoad = &avg
	}
	return masters, orgLoad, nil
}

func availableMinutesFromHours(hours []domain.WorkingHours, from, to time.Time) int {
	if !to.After(from) {
		return 0
	}
	byWeekday := map[int]int{}
	for _, h := range hours {
		byWeekday[h.Weekday] += h.EndMinute - h.StartMinute
	}
	day := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	endDay := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC)
	total := 0
	for day.Before(endDay) {
		total += byWeekday[int(day.Weekday())]
		day = day.Add(24 * time.Hour)
	}
	return total
}

func salonDeltas(curr, prev SalonPeriodMetrics) SalonReportDeltas {
	return SalonReportDeltas{
		TurnoverPercent:       deltaPercentInt64(curr.TurnoverMinor, prev.TurnoverMinor),
		CompletedCountPercent: deltaPercentInt64(curr.CompletedCount, prev.CompletedCount),
		AvgCheckPercent:       deltaPercentAvgCheck(curr.AvgCheckMinor, prev.AvgCheckMinor),
	}
}

func deltaPercentInt64(current, previous int64) *float64 {
	if previous == 0 {
		return nil
	}
	v := float64(current-previous) / float64(previous) * 100
	return &v
}

func deltaPercentAvgCheck(current, previous *int64) *float64 {
	if previous == nil || *previous == 0 || current == nil {
		return nil
	}
	v := float64(*current-*previous) / float64(*previous) * 100
	return &v
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

func (s *Service) fetchReviewStats(ctx context.Context, masterIDs []uuid.UUID, from, to time.Time) (*float64, int64, error) {
	if len(masterIDs) == 0 || s.communicationsURL == "" || s.internalToken == "" {
		return nil, 0, nil
	}
	q := url.Values{}
	for _, id := range masterIDs {
		q.Add("master_user_id", id.String())
	}
	q.Set("from", from.Format(time.RFC3339))
	q.Set("to", to.Format(time.RFC3339))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.communicationsURL+"/v1/internal/reviews/stats?"+q.Encode(), nil)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, 0, apperr.Internal(fmt.Errorf("review stats status %d: %s", resp.StatusCode, string(body)))
	}
	var payload struct {
		Avg   *float64 `json:"avg"`
		Count int64    `json:"count"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, 0, apperr.Internal(err)
	}
	if payload.Avg != nil && (math.IsNaN(*payload.Avg) || math.IsInf(*payload.Avg, 0)) {
		payload.Avg = nil
	}
	return payload.Avg, payload.Count, nil
}
