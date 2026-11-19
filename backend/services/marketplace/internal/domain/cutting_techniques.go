package domain

import "strings"

// Canonical cutting techniques (methods), not services/styles/hair types.
// Keep in sync with frontend/src/shared/lib/cutting-techniques.ts
var CuttingTechniqueCatalog = []string{
	"Тупой срез",
	"Градуировка",
	"Слои",
	"Пойнт-кат",
	"Слайд-кат",
	"Слайс",
	"Филировка",
	"Текстурирование",
	"Бритвенная техника",
	"Ножницы над расчёской",
	"Машинка над расчёской",
	"Фейд",
	"Коннектинг",
	"Фрихэнд",
}

var cuttingTechniqueByKey map[string]string

func init() {
	cuttingTechniqueByKey = make(map[string]string, len(CuttingTechniqueCatalog))
	for _, name := range CuttingTechniqueCatalog {
		cuttingTechniqueByKey[normalizeCuttingKey(name)] = name
	}
}

func normalizeCuttingKey(raw string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(raw)), " "))
}

// NormalizeCuttingTechniques keeps only catalog values, de-duplicated, stable order.
func NormalizeCuttingTechniques(raw []string) []string {
	if len(raw) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		canon, ok := cuttingTechniqueByKey[normalizeCuttingKey(item)]
		if !ok {
			continue
		}
		key := normalizeCuttingKey(canon)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, canon)
	}
	return out
}
