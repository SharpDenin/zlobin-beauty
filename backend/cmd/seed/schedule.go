package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

// demoWorkingDays returns `count` local working days starting from `now`'s calendar day
// (today included when it is Mon–Fri). Dates are noon local so DST does not shift the day.
func demoWorkingDays(now time.Time, count int) []time.Time {
	if count <= 0 {
		return nil
	}
	loc := now.Location()
	cursor := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, loc)
	out := make([]time.Time, 0, count)
	limit := count * 3
	if limit < 50 {
		limit = 50
	}
	for i := 0; i < limit && len(out) < count; i++ {
		d := cursor.AddDate(0, 0, i)
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			continue
		}
		out = append(out, d)
	}
	return out
}

// demoHorizonDays returns weekdays from today's calendar day through at least
// `calendarDays` days ahead. If that date falls on a weekend, the window extends
// to the next weekday so the horizon is never shorter than requested.
func demoHorizonDays(now time.Time, calendarDays int) []time.Time {
	if calendarDays < 0 {
		return nil
	}
	loc := now.Location()
	start := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, loc)
	end := start.AddDate(0, 0, calendarDays)
	for end.Weekday() == time.Saturday || end.Weekday() == time.Sunday {
		end = end.AddDate(0, 0, 1)
	}
	out := make([]time.Time, 0, calendarDays)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			continue
		}
		out = append(out, d)
	}
	return out
}

func findSlotOnDate(c *http.Client, base, masterUserID string, day time.Time, durationMin int) (time.Time, error) {
	date := day.Format("2006-01-02")
	url := fmt.Sprintf("%s/v1/masters/%s/slots?date=%s&duration_minutes=%d", base, masterUserID, date, durationMin)
	var slots struct {
		Items []struct {
			StartsAt time.Time `json:"starts_at"`
		} `json:"items"`
	}
	status, err := doJSON(c, http.MethodGet, url, "", nil, &slots)
	if err != nil {
		return time.Time{}, err
	}
	if status >= 300 || len(slots.Items) == 0 {
		return time.Time{}, fmt.Errorf("no slots on %s", date)
	}
	return slots.Items[0].StartsAt, nil
}

func countOrgDayAppointments(c *http.Client, base string, owner authUser, orgID string, day time.Time) int {
	from := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, day.Location())
	to := from.Add(24 * time.Hour)
	var body struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	url := fmt.Sprintf("%s/v1/calendar/appointments?organization_id=%s&from=%s&to=%s",
		base, orgID, from.UTC().Format(time.RFC3339), to.UTC().Format(time.RFC3339))
	st, err := doJSON(c, http.MethodGet, url, owner.Token, nil, &body)
	if err != nil || st >= 300 {
		return 0
	}
	return len(body.Items)
}

type liveBookingSpec struct {
	client   authUser
	service  string
	duration int
	confirm  bool
}

func seedLiveSalonSchedule(c *http.Client, base string, owner authUser, orgID, profileID string, clients []authUser) error {
	if owner.ID == "" || orgID == "" || profileID == "" || len(clients) == 0 {
		return fmt.Errorf("missing owner/org/profile/clients")
	}
	colorID, err := lookupMasterServiceByName(c, base, owner, "Окрашивание")
	if err != nil {
		return err
	}
	cutID, err := lookupMasterServiceByName(c, base, owner, "Стрижка")
	if err != nil {
		cutID = colorID
	}
	careID, err := lookupMasterServiceByName(c, base, owner, "Уход")
	if err != nil {
		careID = colorID
	}
	services := []struct {
		id       string
		duration int
	}{
		{cutID, 60},
		{careID, 90},
		{colorID, 180},
	}

	days := demoHorizonDays(time.Now(), 31)
	booked := 0
	for i, day := range days {
		existing := countOrgDayAppointments(c, base, owner, orgID, day)
		target := 2 + (i % 3)
		if i == 0 {
			target = 5 // denser “today” for calendar realism
		}
		if existing >= target {
			log.Printf("skip live volume %s — already has %d appointments", day.Format("2006-01-02"), existing)
			continue
		}
		needed := target - existing
		for n := 0; n < needed; n++ {
			client := clients[(i+n)%len(clients)]
			var starts time.Time
			var serviceID string
			var slotErr error
			for k := 0; k < len(services); k++ {
				svc := services[(i+n+k)%len(services)]
				starts, slotErr = findSlotOnDate(c, base, owner.ID, day, svc.duration)
				if slotErr == nil {
					serviceID = svc.id
					break
				}
			}
			if serviceID == "" {
				log.Printf("warn live volume slot %s: %v", day.Format("2006-01-02"), slotErr)
				break
			}
			var appt struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			}
			st, err := doJSON(c, http.MethodPost, base+"/v1/appointments", client.Token, map[string]any{
				"master_id": profileID, "service_id": serviceID, "starts_at": starts,
			}, &appt)
			if err != nil || st >= 300 || appt.ID == "" {
				log.Printf("warn live volume book %s status=%d err=%v", day.Format("2006-01-02"), st, err)
				break
			}
			if appt.Status == "pending_confirmation" || appt.Status == "pending" || appt.Status == "" {
				if (i+n)%4 == 3 {
					log.Printf("ok live volume pending appt=%s day=%s", appt.ID, day.Format("2006-01-02"))
				} else {
					_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/confirm", owner.Token, map[string]any{}, &appt)
					log.Printf("ok live volume confirmed appt=%s day=%s", appt.ID, day.Format("2006-01-02"))
				}
			} else {
				log.Printf("ok live volume appt=%s status=%s day=%s", appt.ID, appt.Status, day.Format("2006-01-02"))
			}
			booked++
		}
	}
	if len(days) > 0 {
		last := days[len(days)-1]
		if countOrgDayAppointments(c, base, owner, orgID, last) == 0 {
			client := clients[0]
			starts, err := findSlotOnDate(c, base, owner.ID, last, 60)
			if err == nil {
				st, bookErr := doJSON(c, http.MethodPost, base+"/v1/appointments", client.Token, map[string]any{
					"master_id": profileID, "service_id": cutID, "starts_at": starts,
				}, nil)
				if bookErr == nil && st < 300 {
					booked++
					log.Printf("ok horizon tail %s", last.Format("2006-01-02"))
				}
			}
		}
	}
	log.Printf("ok live salon schedule booked=%d days=%d last=%s", booked, len(days), days[len(days)-1].Format("2006-01-02"))
	return nil
}

// seedStaffForward places a light, varied set of future visits for a second master
// so the salon calendar is not a single-master clone for the month ahead.
func seedStaffForward(c *http.Client, base string, master authUser, profileID string, serviceIDs []string, clients []authUser) error {
	if profileID == "" || len(serviceIDs) == 0 || len(clients) == 0 {
		return nil
	}
	days := demoHorizonDays(time.Now(), 31)
	booked := 0
	for i, day := range days {
		if i%2 == 0 && i != len(days)-1 {
			continue
		}
		client := clients[i%len(clients)]
		serviceID := serviceIDs[i%len(serviceIDs)]
		duration := 60
		if i%3 == 0 {
			duration = 90
		}
		starts, err := findSlotOnDate(c, base, master.ID, day, duration)
		if err != nil {
			continue
		}
		var appt struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		st, err := doJSON(c, http.MethodPost, base+"/v1/appointments", client.Token, map[string]any{
			"master_id": profileID, "service_id": serviceID, "starts_at": starts,
		}, &appt)
		if err != nil || st >= 300 || appt.ID == "" {
			continue
		}
		if i%4 != 0 && (appt.Status == "pending_confirmation" || appt.Status == "pending" || appt.Status == "") {
			_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/confirm", master.Token, map[string]any{}, nil)
		}
		booked++
	}
	log.Printf("ok staff forward booked=%d master=%s", booked, master.Email)
	return nil
}
