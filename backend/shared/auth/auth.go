package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
)

const (
	AccessTTL  = 15 * time.Minute
	RefreshTTL = 30 * 24 * time.Hour
)

type Claims struct {
	UserID    uuid.UUID `json:"uid"`
	SessionID uuid.UUID `json:"sid"`
	Roles     []string  `json:"roles"`
	jwt.RegisteredClaims
}

type TokenPair struct {
	AccessToken      string
	RefreshToken     string
	RefreshTokenHash string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
	SessionID        uuid.UUID
}

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
	return fmt.Sprintf("argon2id$v=19$m=65536,t=1,p=4$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[0] != "argon2id" || !strings.HasPrefix(parts[1], "v=") {
		return false
	}
	var memory, timeCost, parallelism uint32
	if _, err := fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &memory, &timeCost, &parallelism); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, timeCost, memory, uint8(parallelism), uint32(len(want)))
	if len(got) != len(want) {
		return false
	}
	var diff byte
	for i := range got {
		diff |= got[i] ^ want[i]
	}
	return diff == 0
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func NewRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func IssueAccessToken(secret string, userID, sessionID uuid.UUID, roles []string, now time.Time) (string, time.Time, error) {
	exp := now.Add(AccessTTL)
	claims := Claims{
		UserID:    userID,
		SessionID: sessionID,
		Roles:     roles,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.NewString(),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := t.SignedString([]byte(secret))
	return signed, exp, err
}

func HasRole(claims *Claims, role string) bool {
	if claims == nil {
		return false
	}
	for _, r := range claims.Roles {
		if r == role {
			return true
		}
	}
	return false
}

func HasProfessionalRole(claims *Claims) bool {
	if claims == nil {
		return false
	}
	for _, role := range claims.Roles {
		switch role {
		case "master", "supplier", "supplier_rep", "salon_owner", "salon_admin", "system_admin":
			return true
		}
	}
	return false
}

func ParseAccessToken(secret, token string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

func IssuePair(secret string, userID uuid.UUID, roles []string, now time.Time) (TokenPair, error) {
	sessionID := uuid.Must(uuid.NewV7())
	access, accessExp, err := IssueAccessToken(secret, userID, sessionID, roles, now)
	if err != nil {
		return TokenPair{}, err
	}
	refresh, err := NewRefreshToken()
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{
		AccessToken:      access,
		RefreshToken:     refresh,
		RefreshTokenHash: HashToken(refresh),
		AccessExpiresAt:  accessExp,
		RefreshExpiresAt: now.Add(RefreshTTL),
		SessionID:        sessionID,
	}, nil
}
