package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
)

var seedUploadMu sync.Mutex
var seedUploadCache = map[string]string{}

func emailLocalPart(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	if i := strings.IndexByte(email, '@'); i > 0 {
		return email[:i]
	}
	return email
}

func seedMediaSlug(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	prevDash := false
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevDash = false
			continue
		}
		if prevDash {
			continue
		}
		b.WriteByte('-')
		prevDash = true
	}
	return strings.Trim(b.String(), "-")
}

func contentTypeForExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".webm":
		return "video/webm"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	default:
		return ""
	}
}

func findSeedMediaDir() string {
	if p := strings.TrimSpace(os.Getenv("SEED_MEDIA_DIR")); p != "" {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
		log.Printf("warn SEED_MEDIA_DIR is not a directory: %s", p)
		return ""
	}
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	dir := wd
	for i := 0; i < 10; i++ {
		cand := filepath.Join(dir, "seed", "media")
		if st, err := os.Stat(cand); err == nil && st.IsDir() {
			return cand
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func uploadSeedAssetIfExists(c *http.Client, base, token, purpose string, relPaths ...string) string {
	root := findSeedMediaDir()
	if root == "" {
		return ""
	}
	for _, rel := range relPaths {
		rel = strings.TrimPrefix(filepath.ToSlash(rel), "/")
		if rel == "" {
			continue
		}
		p := filepath.Join(root, filepath.FromSlash(rel))
		seedUploadMu.Lock()
		if id, ok := seedUploadCache[p]; ok {
			seedUploadMu.Unlock()
			return id
		}
		seedUploadMu.Unlock()
		data, err := os.ReadFile(p)
		if err != nil || len(data) == 0 {
			continue
		}
		ct := contentTypeForExt(filepath.Ext(p))
		if ct == "" {
			log.Printf("warn skip seed media %s: unsupported type", rel)
			continue
		}
		id, err := uploadSeedBytes(c, base, token, purpose, filepath.Base(p), ct, data)
		if err != nil {
			log.Printf("warn seed media %s: %v", rel, err)
			continue
		}
		if id != "" {
			seedUploadMu.Lock()
			seedUploadCache[p] = id
			seedUploadMu.Unlock()
			return id
		}
	}
	return ""
}

func mediaLooksPlaceholder(c *http.Client, base, token, mediaID string) bool {
	if mediaID == "" {
		return true
	}
	var meta struct {
		SizeBytes   int64  `json:"size_bytes"`
		ContentType string `json:"content_type"`
	}
	status, err := doJSON(c, http.MethodGet, base+"/v1/media/"+mediaID, token, nil, &meta)
	if err != nil || status >= 300 {
		return false
	}
	if meta.SizeBytes > 0 && meta.SizeBytes < 2048 {
		return true
	}
	return false
}

func withOptionalPortrait(c *http.Client, base string, user authUser, cfg masterSeed) masterSeed {
	var me struct {
		Master struct {
			PhotoMediaID *string `json:"photo_media_id"`
		} `json:"master"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/me/master", user.Token, nil, &me)
	existing := ""
	if me.Master.PhotoMediaID != nil {
		existing = strings.TrimSpace(*me.Master.PhotoMediaID)
	}
	if existing != "" && !mediaLooksPlaceholder(c, base, user.Token, existing) {
		cfg.PhotoMediaID = existing
		return cfg
	}
	local := emailLocalPart(user.Email)
	if local == "" {
		return cfg
	}
	if id := uploadSeedAssetIfExists(c, base, user.Token, "profile",
		"masters/"+local+".jpg",
		"masters/"+local+".jpeg",
		"masters/"+local+".png",
		"masters/"+local+".webp",
	); id != "" {
		cfg.PhotoMediaID = id
	}
	return cfg
}

func attachSeedServicePhoto(c *http.Client, base string, user authUser, serviceID, name, existingID string) {
	if serviceID == "" {
		return
	}
	if existingID != "" && !mediaLooksPlaceholder(c, base, user.Token, existingID) {
		return
	}
	slug := seedMediaSlug(name)
	id := ""
	if slug != "" {
		id = uploadSeedAssetIfExists(c, base, user.Token, "service",
			"services/"+slug+".jpg",
			"services/"+slug+".jpeg",
			"services/"+slug+".png",
			"services/"+slug+".webp",
		)
	}
	if id != "" {
		status, err := doJSON(c, http.MethodPatch, base+"/v1/services/"+serviceID, user.Token, map[string]any{
			"photo_media_id": id,
		}, nil)
		if err != nil || status >= 300 {
			log.Printf("warn attach service photo %s status=%d err=%v", name, status, err)
		}
		return
	}
	if existingID != "" {
		status, err := doJSON(c, http.MethodPatch, base+"/v1/services/"+serviceID, user.Token, map[string]any{
			"photo_media_id": "",
		}, nil)
		if err != nil || status >= 300 {
			log.Printf("warn clear placeholder service photo %s status=%d err=%v", name, status, err)
		}
	}
}

func attachSalonPhotos(c *http.Client, base string, user authUser, branchID string, rels ...string) {
	if branchID == "" || len(rels) == 0 {
		return
	}
	var list struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/branches/"+branchID+"/photos", user.Token, nil, &list)
	if len(list.Items) > 0 {
		return
	}
	for i, rel := range rels {
		id := uploadSeedAssetIfExists(c, base, user.Token, "salon", rel)
		if id == "" {
			continue
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/branches/"+branchID+"/photos", user.Token, map[string]any{
			"media_id": id, "sort_order": i,
		}, nil)
		if err != nil || status >= 300 {
			log.Printf("warn salon photo %s status=%d err=%v", rel, status, err)
			continue
		}
		if i == 0 {
			_, _ = doJSON(c, http.MethodPatch, base+"/v1/branches/"+branchID, user.Token, map[string]any{
				"photo_media_id": id,
			}, nil)
		}
	}
}

func attachSeedPortfolio(c *http.Client, base string, user authUser, rels []string, captions []string) {
	if len(rels) == 0 {
		return
	}
	var list struct {
		Items []json.RawMessage `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/me/master/portfolio", user.Token, nil, &list)
	if len(list.Items) > 0 {
		return
	}
	for i, rel := range rels {
		id := uploadSeedAssetIfExists(c, base, user.Token, "portfolio", rel)
		if id == "" {
			continue
		}
		caption := ""
		if i < len(captions) {
			caption = captions[i]
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/me/master/portfolio", user.Token, map[string]any{
			"media_id": id, "caption": caption,
		}, nil)
		if err != nil || status >= 300 {
			log.Printf("warn portfolio %s status=%d err=%v", rel, status, err)
		}
	}
}
