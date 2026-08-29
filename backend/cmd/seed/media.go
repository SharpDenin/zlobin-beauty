package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

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
			return id
		}
	}
	return ""
}

func withOptionalPortrait(c *http.Client, base string, user authUser, cfg masterSeed) masterSeed {
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

func attachSeedServicePhoto(c *http.Client, base string, user authUser, serviceID, name string, alreadyHasPhoto bool) {
	if alreadyHasPhoto || serviceID == "" {
		return
	}
	slug := seedMediaSlug(name)
	if slug == "" {
		return
	}
	id := uploadSeedAssetIfExists(c, base, user.Token, "service",
		"services/"+slug+".jpg",
		"services/"+slug+".jpeg",
		"services/"+slug+".png",
		"services/"+slug+".webp",
	)
	if id == "" {
		return
	}
	status, err := doJSON(c, http.MethodPatch, base+"/v1/services/"+serviceID, user.Token, map[string]any{
		"photo_media_id": id,
	}, nil)
	if err != nil || status >= 300 {
		log.Printf("warn attach service photo %s status=%d err=%v", name, status, err)
	}
}
