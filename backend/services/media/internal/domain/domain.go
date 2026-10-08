package domain

import (
	"bytes"
	"strings"
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

// Size ceilings. The browser compresses photos before upload, so these are generous limits for
// originals (GIF, PDF) and for direct API clients.
const (
	MaxUploadBytes      = 10 << 20 // images, GIF, PDF
	MaxVideoUploadBytes = 50 << 20 // video
	MaxImageDimension   = 16384    // px per side
	MaxImagePixels      = 100_000_000
)

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
	case "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
		"video/mp4", "video/webm", "video/quicktime":
		return true
	default:
		return false
	}
}

func IsImageContentType(ct string) bool { return strings.HasPrefix(ct, "image/") }
func IsVideoContentType(ct string) bool { return strings.HasPrefix(ct, "video/") }

// MaxBytesForPurpose is the ceiling used while reading the body, before the type is known.
func MaxBytesForPurpose(purpose string) int64 {
	if AllowsVideo(purpose) {
		return MaxVideoUploadBytes
	}
	return MaxUploadBytes
}

// MaxBytesForContentType is the ceiling for an already detected type.
func MaxBytesForContentType(ct string) int64 {
	if IsVideoContentType(ct) {
		return MaxVideoUploadBytes
	}
	return MaxUploadBytes
}

func AllowsVideo(purpose string) bool {
	return purpose == PurposeVideo || purpose == PurposeMessage || purpose == PurposePortfolio
}

// AllowsGIF lists purposes where animated GIFs make sense.
func AllowsGIF(purpose string) bool {
	switch purpose {
	case PurposePortfolio, PurposeMessage, PurposeArticle, PurposeService:
		return true
	default:
		return false
	}
}

// ContentAllowedForPurpose decides whether the DETECTED content type may be stored for a purpose.
func ContentAllowedForPurpose(purpose, ct string) bool {
	if !ValidContentType(ct) {
		return false
	}
	switch {
	case ct == "image/gif":
		return AllowsGIF(purpose)
	case IsVideoContentType(ct):
		return AllowsVideo(purpose)
	case ct == "application/pdf":
		return purpose == PurposeDocument
	default:
		return true // jpeg / png / webp
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
	case "image/gif":
		return ".gif"
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

// SniffContentType detects the real type from magic bytes. The client-declared MIME type is
// never trusted: "" means unknown/unsupported.
func SniffContentType(head []byte) string {
	switch {
	case len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF:
		return "image/jpeg"
	case len(head) >= 8 && bytes.Equal(head[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}):
		return "image/png"
	case len(head) >= 6 && (bytes.Equal(head[:6], []byte("GIF87a")) || bytes.Equal(head[:6], []byte("GIF89a"))):
		return "image/gif"
	case len(head) >= 12 && bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WEBP")):
		return "image/webp"
	case len(head) >= 5 && bytes.Equal(head[:5], []byte("%PDF-")):
		return "application/pdf"
	case len(head) >= 4 && head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3:
		return "video/webm" // EBML container (WebM / Matroska)
	case len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")):
		brand := string(head[8:12])
		switch brand {
		case "qt  ":
			return "video/quicktime"
		case "heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis":
			return "" // HEIC/HEIF images: browsers cannot render them reliably
		default:
			return "video/mp4"
		}
	default:
		return ""
	}
}

// DeclaredCompatible reports whether the client-declared MIME type is consistent with the
// sniffed one. Empty / octet-stream declarations are accepted (the sniffed type wins).
func DeclaredCompatible(declared, sniffed string) bool {
	declared = strings.ToLower(strings.TrimSpace(declared))
	if i := strings.Index(declared, ";"); i >= 0 {
		declared = strings.TrimSpace(declared[:i])
	}
	if declared == "" || declared == "application/octet-stream" || declared == "binary/octet-stream" {
		return true
	}
	if declared == sniffed {
		return true
	}
	// iOS labels MP4 as quicktime and the reverse is common for .mov exports.
	isMov := func(t string) bool { return t == "video/mp4" || t == "video/quicktime" }
	if isMov(declared) && isMov(sniffed) {
		return true
	}
	// Some clients send image/jpg.
	return declared == "image/jpg" && sniffed == "image/jpeg"
}

// IsSharedPurpose returns true for media that any authenticated user may read.
func IsSharedPurpose(purpose string) bool {
	switch purpose {
	case PurposeProfile, PurposeSalon, PurposePortfolio, PurposeProduct, PurposeArticle, PurposeVideo, PurposeService:
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

// IsAppointmentPurpose marks media visible only to the people attached to an appointment.
func IsAppointmentPurpose(purpose string) bool { return purpose == PurposeBeforeAfter }
