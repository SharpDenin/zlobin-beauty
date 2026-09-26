package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	PurposeProfile     = "profile"
	PurposeSalon       = "salon"
	PurposePortfolio   = "portfolio"
	PurposeBeforeAfter = "before_after"
	PurposeProduct     = "product"
	PurposeDelivery    = "delivery"
	PurposeDocument    = "document"
	PurposeArticle     = "article"
	PurposeVideo       = "video"
	PurposeService     = "service"
	PurposeMessage     = "message"
)

const MaxUploadBytes = 5 << 20       // 5 MiB images/docs
const MaxVideoUploadBytes = 50 << 20 // 50 MiB videos

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
	case PurposeProfile, PurposeSalon, PurposePortfolio, PurposeBeforeAfter, PurposeProduct, PurposeDelivery, PurposeDocument, PurposeArticle, PurposeVideo, PurposeService, PurposeMessage:
		return true
	default:
		return false
	}
}

func ValidContentType(ct string) bool {
	switch ct {
	case "image/jpeg", "image/png", "image/webp", "application/pdf",
		"video/mp4", "video/webm", "video/quicktime":
		return true
	default:
		return false
	}
}

func MaxBytesForPurpose(purpose string) int64 {
	if purpose == PurposeVideo || purpose == PurposeMessage {
		return MaxVideoUploadBytes
	}
	return MaxUploadBytes
}

func AllowsVideo(purpose string) bool {
	return purpose == PurposeVideo || purpose == PurposeMessage
}

func ContentAllowedForPurpose(purpose, ct string) bool {
	if purpose == PurposeMessage {
		switch ct {
		case "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime":
			return true
		default:
			return false
		}
	}
	return ValidContentType(ct)
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
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "video/quicktime":
		return ".mov"
	default:
		return ""
	}
}

// IsSharedPurpose returns true for media that any authenticated user may read.
func IsSharedPurpose(purpose string) bool {
	switch purpose {
	case PurposeProfile, PurposeSalon, PurposePortfolio, PurposeProduct, PurposeBeforeAfter, PurposeArticle, PurposeVideo, PurposeService:
		return true
	default:
		return false
	}
}

// IsPublicPurpose returns true for media readable without login (published catalog/profile surfaces).
func IsPublicPurpose(purpose string) bool {
	switch purpose {
	case PurposeProfile, PurposeSalon, PurposePortfolio, PurposeProduct, PurposeArticle, PurposeVideo, PurposeService:
		return true
	default:
		return false
	}
}
