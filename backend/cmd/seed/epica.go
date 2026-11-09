package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const epicaBrand = "EPICA Professional"
const epicaSource = "EPICA Professional official website"

type epicaCatalog struct {
	Source    string         `json:"source"`
	SourceURL string         `json:"sourceUrl"`
	BrandURL  string         `json:"brandUrl"`
	Products  []epicaProduct `json:"products"`
}

type epicaProduct struct {
	ID          string            `json:"id"`
	Title       string            `json:"title"`
	SKU         string            `json:"sku"`
	Category    string            `json:"category"`
	Series      string            `json:"series"`
	ShadeCode   string            `json:"shadeCode"`
	ShadeName   string            `json:"shadeName"`
	Volume      string            `json:"volume"`
	Description string            `json:"description"`
	Composition string            `json:"composition"`
	Usage       string            `json:"usage"`
	Specs       map[string]string `json:"specs"`
	SourceURL   string            `json:"sourceUrl"`
	ImageFile   string            `json:"imageFile"`
}

type epicaExistingArt struct {
	ID    string
	Cover string
}

func seedEpicaKnowledge(c *http.Client, base string, user authUser, orgID string) error {
	return seedEpicaKnowledgePtr(c, base, &user, orgID)
}

func seedEpicaKnowledgePtr(c *http.Client, base string, user *authUser, orgID string) error {
	path := findEpicaCatalog()
	if path == "" {
		log.Printf("warn epica catalog json not found, skip")
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var catalog epicaCatalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return err
	}
	products := normalizeEpicaProducts(catalog.Products)
	if len(products) == 0 {
		log.Printf("warn epica catalog is empty")
		return nil
	}
	if err := user.ensureSession(c, base); err != nil {
		return err
	}
	have, err := existingEpicaArticles(c, base, user.Token)
	if err != nil {
		return err
	}
	articles := []kbArt{epicaBrandArticle(catalog)}
	for _, p := range products {
		articles = append(articles, epicaProductArticle(p))
	}
	created, covered, skipped := 0, 0, 0
	for i, a := range articles {
		if err := user.ensureSession(c, base); err != nil {
			return err
		}
		cover := ""
		if a.CoverFile != "" {
			cover = uploadEpicaCover(c, base, user, a.CoverFile)
		}
		if ex, ok := have[a.Title]; ok {
			if a.CoverFile == "" || cover == "" || ex.Cover != "" || ex.ID == "" {
				skipped++
				continue
			}
			var full struct {
				Title         string `json:"title"`
				Category      string `json:"category"`
				Content       string `json:"content"`
				ContentFormat string `json:"content_format"`
				Brand         string `json:"brand"`
			}
			st, err := doJSON(c, http.MethodGet, base+"/v1/knowledge/"+ex.ID, user.Token, nil, &full)
			if st == http.StatusUnauthorized {
				_ = user.ensureSession(c, base)
				st, err = doJSON(c, http.MethodGet, base+"/v1/knowledge/"+ex.ID, user.Token, nil, &full)
			}
			if err != nil || st >= 300 || strings.TrimSpace(full.Content) == "" {
				log.Printf("warn epica cover fetch %q status=%d err=%v", a.Title, st, err)
				continue
			}
			st, err = doJSON(c, http.MethodPut, base+"/v1/knowledge/"+ex.ID, user.Token, map[string]any{
				"title": full.Title, "category": full.Category, "content": full.Content,
				"content_format": full.ContentFormat, "brand": full.Brand,
				"cover_media_id": cover,
			}, nil)
			if err != nil || st >= 300 {
				log.Printf("warn epica cover put %q status=%d err=%v", a.Title, st, err)
				continue
			}
			ex.Cover = cover
			have[a.Title] = ex
			covered++
			if covered%40 == 0 {
				log.Printf("epica covers %d/%d", i+1, len(articles))
			}
			continue
		}
		payload := map[string]any{
			"title": a.Title, "category": a.Category, "content": a.Content, "brand": a.Brand,
			"author_name": epicaBrand, "organization_id": orgID, "published": true,
			"content_format": "doc_json",
		}
		if cover != "" {
			payload["cover_media_id"] = cover
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/knowledge", user.Token, payload, nil)
		if err != nil {
			return err
		}
		if status >= 300 {
			log.Printf("warn epica knowledge %q status=%d", a.Title, status)
			continue
		}
		created++
		have[a.Title] = epicaExistingArt{Cover: cover}
		if created%40 == 0 {
			log.Printf("epica knowledge %d/%d", i+1, len(articles))
		}
	}
	log.Printf("ok epica knowledge created=%d covered=%d skipped=%d total=%d", created, covered, skipped, len(articles))
	return nil
}

// uploadEpicaCover paces uploads under media's ~40/min limiter and retries 429/401.
func uploadEpicaCover(c *http.Client, base string, user *authUser, rel string) string {
	const maxAttempts = 8
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		_ = user.ensureSession(c, base)
		id := uploadSeedAssetIfExists(c, base, user.Token, "article", rel)
		if id != "" {
			// Stay under uploadsPerMinute=40 on production media.
			time.Sleep(1800 * time.Millisecond)
			return id
		}
		// Force re-auth on likely expiry, then back off for rate limits.
		user.AuthedAt = time.Time{}
		wait := time.Duration(attempt*8) * time.Second
		if wait > 45*time.Second {
			wait = 45 * time.Second
		}
		log.Printf("epica cover retry %s attempt=%d sleep=%s", rel, attempt, wait)
		time.Sleep(wait)
	}
	return ""
}

func existingEpicaArticles(c *http.Client, base, token string) (map[string]epicaExistingArt, error) {
	have := map[string]epicaExistingArt{}
	for offset := 0; offset < 5000; offset += 100 {
		var list struct {
			Items []struct {
				ID           string  `json:"id"`
				Title        string  `json:"title"`
				CoverMediaID *string `json:"cover_media_id"`
			} `json:"items"`
			Total int `json:"total"`
		}
		endpoint := fmt.Sprintf("%s/v1/knowledge?brand=%s&limit=100&offset=%d", base, url.QueryEscape(epicaBrand), offset)
		status, err := doJSON(c, http.MethodGet, endpoint, token, nil, &list)
		if err != nil {
			return nil, err
		}
		if status >= 300 {
			return nil, fmt.Errorf("list epica knowledge status=%d", status)
		}
		if len(list.Items) == 0 {
			break
		}
		for _, item := range list.Items {
			cover := ""
			if item.CoverMediaID != nil {
				cover = strings.TrimSpace(*item.CoverMediaID)
			}
			have[item.Title] = epicaExistingArt{ID: item.ID, Cover: cover}
		}
		if offset+len(list.Items) >= list.Total {
			break
		}
	}
	return have, nil
}

func epicaBrandArticle(catalog epicaCatalog) kbArt {
	brandURL := catalog.BrandURL
	if brandURL == "" {
		brandURL = "https://epica-professional.com/brand/"
	}
	nodes := []any{
		kbHeading(2, "EPICA Professional"),
		kbPara("Профессиональная косметика для волос. Бренд появился в 2018 году в результате сотрудничества российских и итальянских учёных-химиков: официальная формулировка говорит о задаче совместить технологию разработки и качество продукта."),
		kbPara("На странице бренда название EPICA объясняется через итальянское значение — «грандиозный и качественный» продукт. Косметика позиционируется как созданная профессионалами для профессионалов парикмахерского сервиса."),
		kbHeading(3, "Направления каталога"),
		kbList(
			"Окрашивание и осветление",
			"Уход за волосами",
			"Стайлинг",
			"Химическая завивка",
			"Уход за кожей рук",
			"Мужское направление",
			"Аксессуары",
			"Наборы",
		),
		kbHeading(3, "Окрашивание"),
		kbPara("В официальном каталоге окрашивания опубликованы крем-краска COLORSHADE, гель-краска COLORDREAM, кислая гель-краска COLORSOLUTION, оттеночные муссы OVERCOLOR, кремообразные окисляющие эмульсии OXY ACTIVE и эмульсия PROXY для кислой краски."),
		kbPara("На карточках COLORSHADE указано, что палитра включает основную палитру, SPECIAL BLOND и полуперманентную крем-краску PASTEL TONERS. Отдельные артикулы с этими названиями в каталоге не выделены, поэтому в базе сохранены реальные позиции крем-краски."),
		kbLinkPara("Официальная страница бренда", brandURL),
		kbPara("Источник: " + epicaSource),
	}
	body, _ := json.Marshal(map[string]any{"type": "doc", "content": nodes})
	return kbArt{
		Title:     epicaBrand,
		Category:  "Бренд",
		Brand:     epicaBrand,
		Content:   string(body),
		CoverFile: "epica/743.png",
		WithCover: true,
	}
}

func epicaProductArticle(p epicaProduct) kbArt {
	nodes := []any{epicaSheet(p)}
	if text := strings.TrimSpace(p.Description); text != "" {
		nodes = append(nodes, kbHeading(3, "Описание"))
		nodes = append(nodes, kbTextBlocks(text)...)
	}
	if text := strings.TrimSpace(p.Usage); text != "" {
		nodes = append(nodes, kbHeading(3, "Применение"))
		nodes = append(nodes, kbTextBlocks(text)...)
	}
	if specs := epicaSpecLines(p); len(specs) > 0 {
		nodes = append(nodes, kbHeading(3, "Характеристики"))
		nodes = append(nodes, kbList(specs...))
	}
	if text := strings.TrimSpace(p.Composition); text != "" {
		nodes = append(nodes, kbHeading(3, "Состав"))
		nodes = append(nodes, kbPara(text))
	}
	if p.SourceURL != "" {
		nodes = append(nodes, kbLinkPara("Официальная страница продукта", p.SourceURL))
	}
	nodes = append(nodes, kbPara("Источник: "+epicaSource))
	body, _ := json.Marshal(map[string]any{"type": "doc", "content": nodes})
	return kbArt{
		Title:     p.Title,
		Category:  p.Category,
		Brand:     epicaBrand,
		Content:   string(body),
		CoverFile: p.ImageFile,
		WithCover: p.ImageFile != "",
	}
}

func epicaSheet(p epicaProduct) map[string]any {
	return map[string]any{
		"type": "productSheet",
		"attrs": map[string]any{
			"brand":     epicaBrand,
			"category":  p.Category,
			"series":    p.Series,
			"shadeName": p.ShadeName,
			"shadeCode": p.ShadeCode,
			"sku":       p.SKU,
			"volume":    p.Volume,
			"source":    epicaSource,
			"sourceUrl": p.SourceURL,
		},
	}
}

func kbTextBlocks(text string) []any {
	parts := strings.FieldsFunc(text, func(r rune) bool { return r == '\n' })
	out := make([]any, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		out = append(out, kbPara(part))
	}
	return out
}

func kbLinkPara(text, href string) map[string]any {
	return map[string]any{
		"type": "paragraph",
		"content": []map[string]any{{
			"type": "text",
			"text": text,
			"marks": []map[string]any{{
				"type":  "link",
				"attrs": map[string]any{"href": href},
			}},
		}},
	}
}

func epicaSpecLines(p epicaProduct) []string {
	var lines []string
	if p.Series != "" {
		lines = append(lines, "Серия: "+p.Series)
	}
	if p.ShadeCode != "" {
		label := p.ShadeCode
		if p.ShadeName != "" {
			label += " · " + p.ShadeName
		}
		lines = append(lines, "Оттенок: "+label)
	} else if p.ShadeName != "" {
		lines = append(lines, "Оттенок: "+p.ShadeName)
	}
	if p.Volume != "" {
		lines = append(lines, "Объем: "+p.Volume)
	}
	if p.SKU != "" {
		lines = append(lines, "Артикул: "+p.SKU)
	}
	for key, value := range p.Specs {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" || strings.Contains(key, "PROP") || strings.HasPrefix(key, "#") {
			continue
		}
		if key == "Цвет" || key == "Объем" || key == "Объём" {
			continue
		}
		lines = append(lines, key+": "+value)
	}
	return lines
}

var epicaShadeCode = regexp.MustCompile(`(?i)\b(\d{1,2}\.\d{1,2}[a-z]?)\b`)

var epicaSeriesNames = []string{
	"COLD BLOND PRO",
	"COLORSOLUTION",
	"COLORSHADE",
	"COLORDREAM",
	"SILVER BLOND",
	"COLD BLOND",
	"OVERCOLOR",
	"OXY ACTIVE",
	"POST COLOR",
	"PROXY",
}

func normalizeEpicaProducts(in []epicaProduct) []epicaProduct {
	counts := map[string]int{}
	for i := range in {
		in[i].Title = strings.TrimSpace(in[i].Title)
		in[i].Category = strings.TrimSpace(in[i].Category)
		in[i].SKU = strings.TrimSpace(in[i].SKU)
		in[i].Series = epicaSeries(in[i].Title)
		if code := epicaShadeCode.FindString(in[i].Title); code != "" {
			in[i].ShadeCode = code
		}
		if in[i].Title != "" {
			counts[in[i].Title]++
		}
	}
	out := make([]epicaProduct, 0, len(in))
	for _, p := range in {
		if p.Title == "" || p.Category == "" {
			continue
		}
		if counts[p.Title] > 1 && p.SKU != "" {
			p.Title = p.Title + " · арт. " + p.SKU
		}
		out = append(out, p)
	}
	return out
}

func epicaSeries(title string) string {
	upper := strings.ToUpper(title)
	if strings.Contains(upper, "ПАЛИТРА ОТТЕНКОВ") {
		return ""
	}
	for _, name := range epicaSeriesNames {
		if strings.Contains(upper, name) {
			return name
		}
	}
	return ""
}

func findEpicaCatalog() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for i := 0; i < 6; i++ {
		candidate := filepath.Join(dir, "seed", "epica", "catalog.json")
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
