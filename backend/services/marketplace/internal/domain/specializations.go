package domain

import (
	"strings"
)

// SpecializationCatalog maps master_types.slug → allowed specialization tags.
// Keep in sync with frontend/src/shared/lib/master-specializations.ts
var SpecializationCatalog = map[string][]string{
	"colorist": {
		"Колорирование", "AirTouch", "Балаяж", "Омбре", "Тонирование",
		"Обесцвечивание", "Сложное окрашивание", "Коррекция цвета",
	},
	"hairdresser": {
		"Женские стрижки", "Мужские стрижки", "Детские стрижки", "Укладки", "Причёски",
		"Долговременная укладка", "Восстановление волос", "Кератиновое выпрямление",
	},
	"barber": {
		"Классическое бритьё", "Фейд", "Борода и усы", "Детский барберинг",
		"Стрижка машинкой", "Камуфляж седины", "Уход за кожей головы",
	},
	"nail_master": {
		"Классический маникюр", "Аппаратный маникюр", "Покрытие гель-лак",
		"Наращивание ногтей", "Дизайн ногтей", "Укрепление ногтей", "Снятие покрытия",
	},
	"pedicure_master": {
		"Классический педикюр", "Аппаратный педикюр", "Покрытие гель-лак (педикюр)",
		"Обработка стоп", "SPA-педикюр", "Уход за кутикулой",
	},
	"brow_lash": {
		"Архитектура бровей", "Окрашивание бровей", "Ламинирование бровей",
		"Наращивание ресниц", "Ламинирование ресниц", "Коррекция бровей",
	},
	"cosmetologist": {
		"Чистка лица", "Уходовые процедуры", "Пилинги", "Массаж лица",
		"Антивозрастной уход", "Проблемная кожа", "Аппаратная косметология",
	},
}

func NormalizeSpecializationTag(raw string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
}

func specializationKey(tag string) string {
	return strings.ToLower(NormalizeSpecializationTag(tag))
}

// UniqueSpecializations trims, drops empties, and dedupes case-insensitively (stable order).
func UniqueSpecializations(tags []string) []string {
	if len(tags) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(tags))
	seen := map[string]struct{}{}
	for _, raw := range tags {
		tag := NormalizeSpecializationTag(raw)
		if tag == "" {
			continue
		}
		key := specializationKey(tag)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, tag)
	}
	return out
}

// AllowedSpecializationsForSlugs returns the union of catalog tags for the given slugs.
func AllowedSpecializationsForSlugs(slugs []string) map[string]string {
	allowed := map[string]string{} // key → canonical display form
	for _, slug := range slugs {
		for _, tag := range SpecializationCatalog[slug] {
			key := specializationKey(tag)
			if _, ok := allowed[key]; !ok {
				allowed[key] = tag
			}
		}
	}
	return allowed
}

// FilterSpecializationsForSlugs keeps only tags present in the catalog for the given slugs.
// Legacy free-text tags that are not in the catalog are dropped.
func FilterSpecializationsForSlugs(tags []string, slugs []string) []string {
	allowed := AllowedSpecializationsForSlugs(slugs)
	if len(allowed) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(tags))
	seen := map[string]struct{}{}
	for _, raw := range UniqueSpecializations(tags) {
		key := specializationKey(raw)
		canon, ok := allowed[key]
		if !ok {
			continue
		}
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, canon)
	}
	return out
}

// HasValidSpecialization reports whether at least one non-empty tag is present.
func HasValidSpecialization(tags []string) bool {
	for _, t := range tags {
		if NormalizeSpecializationTag(t) != "" {
			return true
		}
	}
	return false
}
