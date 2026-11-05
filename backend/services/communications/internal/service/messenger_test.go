package service

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestPeerNameOfUsesOtherParticipant(t *testing.T) {
	actor := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	peer := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	c := domain.Conversation{
		Participants: []domain.Participant{
			{UserID: actor, DisplayName: "Me"},
			{UserID: peer, DisplayName: "Анна Волкова"},
		},
	}
	if got := peerNameOf(c, actor); got != "Анна Волкова" {
		t.Fatalf("peer name: %q", got)
	}
}

func TestRateCreateAndFirstLimits(t *testing.T) {
	if rateCreateLimit != 10 || rateCreateWindow != time.Hour {
		t.Fatalf("create limit: %d / %v", rateCreateLimit, rateCreateWindow)
	}
	if rateFirstLimit != 5 || rateFirstWindow != 10*time.Minute {
		t.Fatalf("first message limit: %d / %v", rateFirstLimit, rateFirstWindow)
	}
}

func TestConversationKeysStable(t *testing.T) {
	a := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	b := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	if ContextKeyClientMaster(a, b) != ContextKeyClientMaster(b, a) {
		t.Fatal("client-master key must be order-independent")
	}
	org := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	if ContextKeyMasterSupplier(a, org) == ContextKeyMasterSupplier(b, org) {
		t.Fatal("different masters must not share a supplier conversation key")
	}
}

func TestValidateMessageContent(t *testing.T) {
	if err := ValidateMessageContent("", false); err == nil {
		t.Fatal("empty text without media must be rejected")
	}
	if err := ValidateMessageContent("   ", false); err == nil {
		t.Fatal("whitespace-only text must be rejected")
	}
	if err := ValidateMessageContent("", true); err != nil {
		t.Fatalf("attachment-only message must be allowed: %v", err)
	}
	if err := ValidateMessageContent("hello", false); err != nil {
		t.Fatalf("text message must be allowed: %v", err)
	}
	if err := ValidateMessageContent("полный идиот", false); err == nil {
		t.Fatal("moderated body must be rejected")
	} else if ae, ok := apperr.As(err); !ok || ae.Code != apperr.CodeContentNotAllowed {
		t.Fatalf("expected content_not_allowed, got %v", err)
	}
	long := strings.Repeat("я", domain.MaxMessageRunes+1)
	err := ValidateMessageContent(long, false)
	if err == nil {
		t.Fatal("over-limit body must be rejected")
	}
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 400 {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestMessageKindFromContentType(t *testing.T) {
	if MessageKindFromContentType("", false) != domain.MessageKindText {
		t.Fatal("no media is text")
	}
	if MessageKindFromContentType("image/jpeg", true) != domain.MessageKindImage {
		t.Fatal("jpeg is image")
	}
	if MessageKindFromContentType("video/mp4", true) != domain.MessageKindVideo {
		t.Fatal("mp4 is video")
	}
	if MessageKindFromContentType("VIDEO/WEBM", true) != domain.MessageKindVideo {
		t.Fatal("webm is video")
	}
}

func TestMessagePreview(t *testing.T) {
	if got := messagePreview(domain.Message{Body: "  привет  ", Kind: domain.MessageKindText}); got != "привет" {
		t.Fatalf("text preview: %q", got)
	}
	if got := messagePreview(domain.Message{Kind: domain.MessageKindImage}); got != "Фото" {
		t.Fatalf("image preview: %q", got)
	}
	if got := messagePreview(domain.Message{Kind: domain.MessageKindVideo}); got != "Видео" {
		t.Fatalf("video preview: %q", got)
	}
	long := strings.Repeat("а", 90)
	got := messagePreview(domain.Message{Body: long})
	if !strings.HasSuffix(got, "…") || len([]rune(got)) != 81 {
		t.Fatalf("truncated preview: %q", got)
	}
}
