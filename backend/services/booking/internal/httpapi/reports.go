package httpapi

import (
	"encoding/csv"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerReportRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/reports/salon", auth(http.HandlerFunc(a.salonReport)))
	mux.Handle("GET /v1/reports/salon.csv", auth(http.HandlerFunc(a.salonReportCSV)))
}

func (a *API) parseSalonReportQuery(r *http.Request) (uuid.UUID, time.Time, time.Time, error) {
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		return uuid.Nil, time.Time{}, time.Time{}, apperr.Validation("organization_id is required")
	}
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	if fromStr == "" || toStr == "" {
		return uuid.Nil, time.Time{}, time.Time{}, apperr.Validation("from and to are required (RFC3339)")
	}
	from, err := time.Parse(time.RFC3339, fromStr)
	if err != nil {
		return uuid.Nil, time.Time{}, time.Time{}, apperr.Validation("invalid from timestamp")
	}
	to, err := time.Parse(time.RFC3339, toStr)
	if err != nil {
		return uuid.Nil, time.Time{}, time.Time{}, apperr.Validation("invalid to timestamp")
	}
	if !to.After(from) {
		return uuid.Nil, time.Time{}, time.Time{}, apperr.Validation("to must be after from")
	}
	return orgID, from, to, nil
}

func (a *API) salonReport(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, from, to, err := a.parseSalonReportQuery(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	res, err := a.svc.SalonReport(r.Context(), claims.UserID, orgID, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, salonReportDTO(*res))
}

func (a *API) salonReportCSV(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, from, to, err := a.parseSalonReportQuery(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	res, err := a.svc.SalonReport(r.Context(), claims.UserID, orgID, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="salon-report.csv"`)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"section", "metric", "current", "previous", "delta_percent"})
	writeCSVMetric(cw, "summary", "turnover_minor", res.Current.TurnoverMinor, res.Previous.TurnoverMinor, res.Deltas.TurnoverPercent)
	writeCSVMetric(cw, "summary", "completed_count", res.Current.CompletedCount, res.Previous.CompletedCount, res.Deltas.CompletedCountPercent)
	writeCSVMetricOptional(cw, "summary", "avg_check_minor", res.Current.AvgCheckMinor, res.Previous.AvgCheckMinor, res.Deltas.AvgCheckPercent)
	writeCSVMetricOptionalFloat(cw, "summary", "repeat_visit_percent", res.Current.RepeatVisitPercent, res.Previous.RepeatVisitPercent, nil)
	writeCSVMetricOptionalFloat(cw, "summary", "master_load_percent", res.Current.MasterLoadPercent, res.Previous.MasterLoadPercent, nil)
	writeCSVMetricOptionalFloat(cw, "summary", "satisfaction_avg", res.Current.SatisfactionAvg, res.Previous.SatisfactionAvg, nil)
	_ = cw.Write([]string{"summary", "satisfaction_count", fmtInt64(res.Current.SatisfactionCount), fmtInt64(res.Previous.SatisfactionCount), ""})
	for _, m := range res.Masters {
		load := ""
		if m.LoadPercent != nil {
			load = fmt.Sprintf("%.2f", *m.LoadPercent)
		}
		_ = cw.Write([]string{
			"master", m.MasterUserID.String(),
			fmtInt64(m.BookedMinutes), fmtInt64(m.AvailableMinutes), load,
		})
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		a.log.Error("salon report csv", slog.String("error", err.Error()))
	}
}

func salonReportDTO(res service.SalonReportResult) map[string]any {
	masters := make([]map[string]any, 0, len(res.Masters))
	for _, m := range res.Masters {
		masters = append(masters, map[string]any{
			"master_user_id":    m.MasterUserID.String(),
			"booked_minutes":    m.BookedMinutes,
			"available_minutes": m.AvailableMinutes,
			"load_percent":      m.LoadPercent,
		})
	}
	return map[string]any{
		"organization_id": res.OrganizationID.String(),
		"from":            res.From,
		"to":              res.To,
		"current":         periodMetricsDTO(res.Current),
		"previous":        periodMetricsDTO(res.Previous),
		"deltas": map[string]any{
			"turnover_percent":        res.Deltas.TurnoverPercent,
			"completed_count_percent": res.Deltas.CompletedCountPercent,
			"avg_check_percent":       res.Deltas.AvgCheckPercent,
		},
		"masters": masters,
		"formulas": map[string]any{
			"turnover":      res.Formulas.Turnover,
			"avg_check":     res.Formulas.AvgCheck,
			"repeat_visits": res.Formulas.RepeatVisits,
			"master_load":   res.Formulas.MasterLoad,
			"satisfaction":  res.Formulas.Satisfaction,
		},
	}
}

func periodMetricsDTO(m service.SalonPeriodMetrics) map[string]any {
	return map[string]any{
		"turnover_minor":       m.TurnoverMinor,
		"completed_count":      m.CompletedCount,
		"avg_check_minor":      m.AvgCheckMinor,
		"repeat_visit_percent": m.RepeatVisitPercent,
		"master_load_percent":  m.MasterLoadPercent,
		"satisfaction_avg":     m.SatisfactionAvg,
		"satisfaction_count":   m.SatisfactionCount,
	}
}

func writeCSVMetric(w *csv.Writer, section, metric string, current, previous int64, delta *float64) {
	_ = w.Write([]string{section, metric, fmtInt64(current), fmtInt64(previous), fmtDelta(delta)})
}

func writeCSVMetricOptional(w *csv.Writer, section, metric string, current, previous *int64, delta *float64) {
	_ = w.Write([]string{section, metric, fmtOptionalInt64(current), fmtOptionalInt64(previous), fmtDelta(delta)})
}

func writeCSVMetricOptionalFloat(w *csv.Writer, section, metric string, current, previous *float64, delta *float64) {
	_ = w.Write([]string{section, metric, fmtOptionalFloat(current), fmtOptionalFloat(previous), fmtDelta(delta)})
}

func fmtInt64(v int64) string { return strconv.FormatInt(v, 10) }

func fmtOptionalInt64(v *int64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatInt(*v, 10)
}

func fmtOptionalFloat(v *float64) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%.2f", *v)
}

func fmtDelta(v *float64) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%.2f", *v)
}
