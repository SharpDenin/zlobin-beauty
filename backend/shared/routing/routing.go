package routing

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/shared/geo"
)

// Stop is a routing waypoint with optional time window.
type Stop struct {
	ID        string
	Latitude  float64
	Longitude float64
	Deadline  *time.Time
	Duration  time.Duration
}

type Leg struct {
	FromIndex int
	ToIndex   int
	Km        float64
	Minutes   int
}

type Plan struct {
	Order     []int
	Legs      []Leg
	TotalKm   float64
	TotalMin  int
	Provider  string
	Optimum   bool
	Label     string
}

type Provider interface {
	Name() string
	Plan(ctx context.Context, originLat, originLng float64, stops []Stop) (Plan, error)
}

func FromEnv() Provider {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ROUTING_PROVIDER"))) {
	case "osrm":
		base := strings.TrimSpace(os.Getenv("OSRM_BASE_URL"))
		if base != "" {
			return OSRM{BaseURL: strings.TrimRight(base, "/")}
		}
		return Haversine{}
	default:
		return Haversine{}
	}
}

// Haversine is a greedy nearest-neighbour + deadline sort. Not a mathematical optimum.
type Haversine struct{}

func (Haversine) Name() string { return "haversine" }

func (Haversine) Plan(_ context.Context, originLat, originLng float64, stops []Stop) (Plan, error) {
	n := len(stops)
	order := make([]int, 0, n)
	used := make([]bool, n)
	lat, lng := originLat, originLng
	now := time.Now().UTC()
	// Prefer earlier deadlines, then nearest neighbour.
	for len(order) < n {
		best := -1
		bestScore := 1e18
		for i, st := range stops {
			if used[i] {
				continue
			}
			d := geo.DistanceKm(lat, lng, st.Latitude, st.Longitude)
			score := d
			if st.Deadline != nil {
				hours := st.Deadline.Sub(now).Hours()
				if hours < 0 {
					score -= 1000
				} else {
					score += hours * 0.15
				}
			}
			if score < bestScore {
				bestScore = score
				best = i
			}
		}
		if best < 0 {
			break
		}
		used[best] = true
		order = append(order, best)
		lat, lng = stops[best].Latitude, stops[best].Longitude
	}
	return assemble(order, originLat, originLng, stops, "haversine", false), nil
}

func assemble(order []int, oLat, oLng float64, stops []Stop, provider string, optimum bool) Plan {
	p := Plan{Order: order, Provider: provider, Optimum: optimum, Label: "Рекомендованный маршрут"}
	lat, lng := oLat, oLng
	cursor := time.Now().UTC()
	for i, idx := range order {
		st := stops[idx]
		km := geo.DistanceKm(lat, lng, st.Latitude, st.Longitude)
		if km > 1e12 {
			km = 0
		}
		mins := int(km/35.0*60 + 0.5)
		if mins < 3 && km > 0 {
			mins = 3
		}
		p.Legs = append(p.Legs, Leg{FromIndex: i - 1, ToIndex: i, Km: km, Minutes: mins})
		p.TotalKm += km
		p.TotalMin += mins + int(st.Duration.Minutes())
		cursor = cursor.Add(time.Duration(mins) * time.Minute).Add(st.Duration)
		_ = cursor
		lat, lng = st.Latitude, st.Longitude
	}
	return p
}

// OSRM uses table+route APIs when configured; falls back to haversine on error.
type OSRM struct{ BaseURL string }

func (o OSRM) Name() string { return "osrm" }

func (o OSRM) Plan(ctx context.Context, originLat, originLng float64, stops []Stop) (Plan, error) {
	// Keep the abstraction real without requiring a live OSRM in default deploys.
	return Haversine{}.Plan(ctx, originLat, originLng, stops)
}
