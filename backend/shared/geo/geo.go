package geo

import "math"

const earthRadiusKm = 6371.0

// DistanceKm returns the haversine distance in kilometres.
func DistanceKm(lat1, lng1, lat2, lng2 float64) float64 {
	if !validCoord(lat1, lng1) || !validCoord(lat2, lng2) {
		return math.Inf(1)
	}
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	Δφ := (lat2 - lat1) * math.Pi / 180
	Δλ := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(Δφ/2)*math.Sin(Δφ/2) + math.Cos(φ1)*math.Cos(φ2)*math.Sin(Δλ/2)*math.Sin(Δλ/2)
	return 2 * earthRadiusKm * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func validCoord(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat == 0 && lng == 0)
}

// NearestIndex returns the index of the nearest remaining point to (lat,lng).
func NearestIndex(lat, lng float64, lats, lngs []float64, used []bool) int {
	best := -1
	bestD := math.Inf(1)
	for i := range lats {
		if used[i] {
			continue
		}
		d := DistanceKm(lat, lng, lats[i], lngs[i])
		if d < bestD {
			bestD = d
			best = i
		}
	}
	return best
}
