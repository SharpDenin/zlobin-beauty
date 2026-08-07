package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	PurposeProfile      = "profile"
	PurposeSalon        = "salon"
	PurposePortfolio    = "portfolio"
	PurposeBeforeAfter  = "before_after"
	PurposeProduct      = "product"
	PurposeDelivery     = "delivery"
	PurposeDocument     = "document"
)

const MaxUploadBytes = 5 << 20 // 5 MiB

type MediaObject struct {
	ID           uuid.UUID
	OwnerUserID  uuid.UUID
	Purpose      string
	ContentType  string
	SizeBytes    int64
	SHA256       string
	ObjectKey    string
	Bucket       string
	OriginalName string
	CreatedAt    time.Time
}

func ValidPurpose(p string) bool {
	switch p {
	case PurposeProfile, PurposeSalon, PurposePortfolio, PurposeBeforeAfter, PurposeProduct, PurposeDelivery, PurposeDocument:
		return true
	default:
		return false
	}
}

func ValidContentType(ct string) bool {
	switch ct {
	case "image/jpeg", "image/png", "image/webp", "application/pdf":
		return true
	default:
		return false
	}
}

func ExtensionForContentType(ct string) string {
	switch ct {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "application/pdf":
		return ".pdf"
	default:
		return ""
	}
}

// IsSharedPurpose returns true for media that any authenticated user may read.
func IsSharedPurpose(purpose string) bool {
	switch purpose {
	case PurposeProfile, PurposeSalon, PurposePortfolio, PurposeProduct, PurposeBeforeAfter:
		return true
	default:
		return false
	}
}

// IsPublicPurpose returns true for media readable without login (published catalog/profile surfaces).
func IsPublicPurpose(purpose string) bool {
	switch purpose {
	case PurposeProfile, PurposeSalon, PurposePortfolio, PurposeProduct:
		return true
	default:
		return false
	}
}
