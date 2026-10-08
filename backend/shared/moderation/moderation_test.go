package moderation

import (
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestCheckAllowsOrdinaryBeautyVocabulary(t *testing.T) {
	ok := []string{
		"",
		"Окрашивание AirTouch и тупой срез",
		"Скипидар не используем",
		"Требуется мастер маникюра, ребёнок до 12 лет со скидкой",
		"Хуан Карлос — колорист",
		"Мандарин и манго в составе",
		"Ебеневская улица, дом 5",
		"Классная стрижка, спасибо мастеру!",
		"Fuchsia shade, bitcoin payments, dickens",
		"Запись на 14:30, кабинет 12",
	}
	for _, text := range ok {
		if res := Check(text); !res.Allowed {
			t.Fatalf("expected %q to be allowed, got matches %v", text, res.Matches)
		}
	}
}

func TestCheckBlocksProfanityInsultsAndObfuscation(t *testing.T) {
	bad := []string{
		"ты идиот",
		"вы все дебилы",
		"пошёл нахуй",
		"охуенно",
		"это пиздец",
		"п и з д е ц",
		"ХУУУУЙ",
		"xуй",
		"что за хуйня",
		"вот мудак",
		"you are a bitch",
		"fuck this",
		"сука!",
		"блядь",
		"пидор",
		"ты уебан",
		"долбоёб",
		"мразь",
	}
	for _, text := range bad {
		if res := Check(text); res.Allowed {
			t.Fatalf("expected %q to be blocked", text)
		}
	}
}

func TestValidateFieldsReportsOffendingKeys(t *testing.T) {
	err := ValidateFields(map[string]string{
		"name":        "Стрижка",
		"description": "лучший мудак города",
		"comment":     "ok",
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.CodeContentNotAllowed {
		t.Fatalf("unexpected error %#v", err)
	}
	fields, _ := ae.Details["fields"].(map[string]string)
	if _, bad := fields["description"]; !bad || len(fields) != 1 {
		t.Fatalf("expected only description flagged, got %v", fields)
	}
	if err := ValidateFields(map[string]string{"name": "Окрашивание"}); err != nil {
		t.Fatalf("clean fields must pass: %v", err)
	}
}

func TestExtraWordsFromEnv(t *testing.T) {
	t.Setenv("MODERATION_EXTRA_WORDS", "запрещеночка, Спамслово")
	extraOnce.Do(func() {})
	loadExtra()
	if Check("тут запрещеночка").Allowed {
		t.Fatal("extra word must be blocked")
	}
	if Check("Спамслово!").Allowed {
		t.Fatal("extra word must be blocked case-insensitively")
	}
}
