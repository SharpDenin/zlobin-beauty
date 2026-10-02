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
	for i := 0; i < 21 && len(out) < count; i++ {
		d := cursor.AddDate(0, 0, i)
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

	days := demoWorkingDays(time.Now(), 6)
	booked := 0
	for i, day := range days {
		if countOrgDayAppointments(c, base, owner, orgID, day) >= 4 {
			log.Printf("skip live volume %s — already has appointments", day.Format("2006-01-02"))
			continue
		}
		client := clients[i%len(clients)]
		svc := services[i%len(services)]
		starts, err := findSlotOnDate(c, base, owner.ID, day, svc.duration)
		if err != nil {
			log.Printf("warn live volume slot %s: %v", day.Format("2006-01-02"), err)
			continue
		}
		var appt struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		st, err := doJSON(c, http.MethodPost, base+"/v1/appointments", client.Token, map[string]any{
			"master_id": profileID, "service_id": svc.id, "starts_at": starts,
		}, &appt)
		if err != nil || st >= 300 || appt.ID == "" {
			log.Printf("warn live volume book %s status=%d err=%v", day.Format("2006-01-02"), st, err)
			continue
		}
		if appt.Status == "pending_confirmation" || appt.Status == "pending" || appt.Status == "" {
			if i%4 == 3 {
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
	log.Printf("ok live salon schedule booked=%d days=%d", booked, len(days))
	return nil
}
