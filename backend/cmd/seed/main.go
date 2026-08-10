// Command seed loads demo accounts and sample data through the API gateway.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultPassword = "Password123!"

func main() {
	base := strings.TrimRight(envOr("GATEWAY_URL", "http://localhost:8080"), "/")
	password := envOr("SEED_PASSWORD", defaultPassword)
	client := &http.Client{Timeout: 30 * time.Second}

	log.Printf("seed: gateway=%s", base)
	if err := waitHealth(client, base); err != nil {
		fatal("gateway health: %v", err)
	}

	accounts := []accountSpec{
		{Email: "client1@demo.local", Name: "Клиент Один", Role: "client"},
		{Email: "client2@demo.local", Name: "Клиент Два", Role: "client"},
		{Email: "master1@demo.local", Name: "Мастер Анна", Role: "master"},
		{Email: "master2@demo.local", Name: "Мастер Иван", Role: "master"},
		{Email: "supplier1@demo.local", Name: "Поставщик Профи", Role: "supplier"},
	}
	users := map[string]authUser{}
	for _, a := range accounts {
		u, err := loginOrRegister(client, base, a, password)
		if err != nil {
			fatal("auth %s: %v", a.Email, err)
		}
		users[a.Email] = u
		log.Printf("ok account %s id=%s roles=%v", a.Email, u.ID, u.Roles)
	}

	master1 := users["master1@demo.local"]
	master2 := users["master2@demo.local"]
	supplier1 := users["supplier1@demo.local"]
	client1 := users["client1@demo.local"]

	m1Org, m1Branch, m1Profile, m1Service, err := seedMaster(client, base, master1, masterSeed{
		OrgName:    "Салон Анны (demo)",
		BranchName: "Москва центр",
		City:       "Москва",
		Address:    "ул. Тверская, 1",
		Phone:      "+79001112233",
		Timezone:   "Europe/Moscow",
		Display:    "Анна Колористика",
		Bio:        "Мастер-колорист с опытом работы в Москве. Демо-профиль для Zlobin Beauty.",
		Specs:      []string{"колористика", "стрижки"},
		Experience: 7,
		Education:  "Академия колористики",
		Services: []serviceSpec{
			{Name: "Стрижка", Category: "стрижки", Duration: 60, Price: 200000},
			{Name: "Окрашивание", Category: "колористика", Duration: 180, Price: 500000},
			{Name: "Уход", Category: "уход", Duration: 90, Price: 350000},
		},
	})
	if err != nil {
		fatal("master1: %v", err)
	}
	log.Printf("ok master1 org=%s branch=%s profile=%s service=%s", m1Org, m1Branch, m1Profile, m1Service)

	_, _, _, _, err = seedMaster(client, base, master2, masterSeed{
		OrgName:    "Салон Ивана (demo)",
		BranchName: "Москва юг",
		City:       "Москва",
		Address:    "ул. Варшавская, 10",
		Phone:      "+79004445566",
		Timezone:   "Europe/Moscow",
		Display:    "Иван Стилист",
		Bio:        "Стилист и мастер укладок. Демо-профиль для Zlobin Beauty.",
		Specs:      []string{"стрижки", "укладки"},
		Experience: 5,
		Education:  "Школа стиля",
		Services: []serviceSpec{
			{Name: "Мужская стрижка", Category: "стрижки", Duration: 45, Price: 150000},
			{Name: "Укладка", Category: "укладки", Duration: 60, Price: 250000},
			{Name: "Борода", Category: "барбер", Duration: 30, Price: 100000},
		},
	})
	if err != nil {
		fatal("master2: %v", err)
	}
	log.Printf("ok master2 seeded")

	supOrg, products, err := seedSupplier(client, base, supplier1)
	if err != nil {
		fatal("supplier: %v", err)
	}
	log.Printf("ok supplier org=%s products=%d", supOrg, len(products))

	if err := seedKnowledge(client, base, master1, m1Org); err != nil {
		log.Printf("warn knowledge: %v", err)
	} else {
		log.Printf("ok knowledge articles")
	}

	apptID, err := seedAppointments(client, base, client1, master1, m1Profile, m1Service)
	if err != nil {
		log.Printf("warn appointments: %v", err)
	} else if apptID != "" {
		log.Printf("ok appointment=%s", apptID)
	}

	if err := seedOrders(client, base, master1, supplier1, m1Org, m1Branch, products); err != nil {
		log.Printf("warn orders: %v", err)
	} else {
		log.Printf("ok supplier orders")
	}

	log.Printf("seed complete")
	log.Printf("demo accounts password=%s", password)
	log.Printf("demo supplier_org_id=%s (paste into master Cosmetics page)", supOrg)
}

// --- types ---

type accountSpec struct {
	Email string
	Name  string
	Role  string
}

type authUser struct {
	Token string
	ID    string
	Roles []string
}

type serviceSpec struct {
	Name     string
	Category string
	Duration int
	Price    int64
}

type masterSeed struct {
	OrgName, BranchName, City, Address, Phone, Timezone string
	Display, Bio, Education                             string
	Specs                                               []string
	Experience                                          int
	Services                                            []serviceSpec
}

type apiError struct {
	Status int
	Body   string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.Status, truncate(e.Body, 300))
}

// --- auth ---

func loginOrRegister(c *http.Client, base string, a accountSpec, password string) (authUser, error) {
	var loginResp struct {
		AccessToken string `json:"access_token"`
		User        struct {
			ID    string   `json:"id"`
			Roles []string `json:"roles"`
		} `json:"user"`
	}
	status, err := doJSON(c, http.MethodPost, base+"/v1/auth/login", "", map[string]any{
		"email": a.Email, "password": password,
	}, &loginResp)
	if err == nil && status < 300 {
		return authUser{Token: loginResp.AccessToken, ID: loginResp.User.ID, Roles: loginResp.User.Roles}, nil
	}

	reg := map[string]any{
		"email": a.Email, "password": password, "display_name": a.Name,
	}
	switch a.Role {
	case "master":
		reg["as_master"] = true
	case "supplier":
		reg["as_supplier"] = true
	}
	status, err = doJSON(c, http.MethodPost, base+"/v1/auth/register", "", reg, &loginResp)
	if err != nil {
		return authUser{}, err
	}
	if status >= 300 {
		return authUser{}, &apiError{Status: status, Body: fmt.Sprintf("register failed for %s", a.Email)}
	}
	return authUser{Token: loginResp.AccessToken, ID: loginResp.User.ID, Roles: loginResp.User.Roles}, nil
}

// --- master / org ---

func seedMaster(c *http.Client, base string, user authUser, cfg masterSeed) (orgID, branchID, profileID, firstServiceID string, err error) {
	orgID, branchID, err = ensureOrg(c, base, user, "salon", cfg.OrgName, cfg.BranchName, cfg.City, cfg.Address, cfg.Timezone)
	if err != nil {
		return "", "", "", "", err
	}

	// Branch readiness requires phone.
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/branches/"+branchID, user.Token, map[string]any{
		"phone": cfg.Phone, "city": cfg.City, "address_line": cfg.Address, "timezone": cfg.Timezone,
	}, nil)

	// Draft profile first (publication needs services + hours).
	_, err = upsertMaster(c, base, user, orgID, branchID, cfg, false)
	if err != nil {
		return "", "", "", "", fmt.Errorf("upsert draft: %w", err)
	}

	services, err := ensureServices(c, base, user, orgID, cfg.Services)
	if err != nil {
		return "", "", "", "", err
	}
	if len(services) > 0 {
		firstServiceID = services[0]
	}

	hours := make([]map[string]any, 0, 5)
	for wd := 1; wd <= 5; wd++ { // Mon-Fri
		hours = append(hours, map[string]any{
			"weekday": wd, "start_minute": 10 * 60, "end_minute": 19 * 60,
		})
	}
	status, err := doJSON(c, http.MethodPut, base+"/v1/me/working-hours", user.Token, map[string]any{"items": hours}, nil)
	if err != nil {
		return "", "", "", "", err
	}
	if status >= 300 {
		log.Printf("warn working-hours status=%d", status)
	}

	profileID, err = upsertMaster(c, base, user, orgID, branchID, cfg, true)
	if err != nil {
		// Publish may fail if readiness incomplete; keep draft profile id.
		log.Printf("warn publish master profile: %v", err)
		profileID, _ = upsertMaster(c, base, user, orgID, branchID, cfg, false)
	}

	pub := true
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/branches/"+branchID, user.Token, map[string]any{"published": pub}, nil)
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/organizations/"+orgID, user.Token, map[string]any{"published": pub}, nil)

	// Salon warehouse location for supplier orders.
	if _, err := ensureLocation(c, base, user, orgID, "Основной склад", "salon"); err != nil {
		log.Printf("warn salon location: %v", err)
	}

	return orgID, branchID, profileID, firstServiceID, nil
}

func upsertMaster(c *http.Client, base string, user authUser, orgID, branchID string, cfg masterSeed, published bool) (string, error) {
	var resp struct {
		ID string `json:"id"`
	}
	status, err := doJSON(c, http.MethodPut, base+"/v1/me/master", user.Token, map[string]any{
		"organization_id":  orgID,
		"branch_id":        branchID,
		"display_name":     cfg.Display,
		"bio":              cfg.Bio,
		"specializations":  cfg.Specs,
		"city":             cfg.City,
		"experience_years": cfg.Experience,
		"education":        cfg.Education,
		"published":        published,
	}, &resp)
	if err != nil {
		return "", err
	}
	if status >= 300 {
		return "", &apiError{Status: status, Body: "upsert master failed"}
	}
	if resp.ID == "" {
		// GET fallback
		var me struct {
			Master struct {
				ID string `json:"id"`
			} `json:"master"`
		}
		_, _ = doJSON(c, http.MethodGet, base+"/v1/me/master", user.Token, nil, &me)
		resp.ID = me.Master.ID
	}
	return resp.ID, nil
}

func ensureOrg(c *http.Client, base string, user authUser, typ, name, branchName, city, address, tz string) (orgID, branchID string, err error) {
	var mine struct {
		Items []struct {
			Organization struct {
				ID   string `json:"id"`
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"organization"`
			Branches []struct {
				ID string `json:"id"`
			} `json:"branches"`
		} `json:"items"`
	}
	status, err := doJSON(c, http.MethodGet, base+"/v1/organizations/mine", user.Token, nil, &mine)
	if err != nil {
		return "", "", err
	}
	if status < 300 {
		for _, it := range mine.Items {
			if it.Organization.Type == typ || (typ == "salon" && it.Organization.Type == "") {
				orgID = it.Organization.ID
				if len(it.Branches) > 0 {
					branchID = it.Branches[0].ID
				}
				log.Printf("skip org create for %s — using existing %s", user.ID, orgID)
				return orgID, branchID, nil
			}
		}
	}

	var created struct {
		Organization struct {
			ID string `json:"id"`
		} `json:"organization"`
		Branch struct {
			ID string `json:"id"`
		} `json:"branch"`
	}
	status, err = doJSON(c, http.MethodPost, base+"/v1/organizations", user.Token, map[string]any{
		"name": name, "type": typ, "branch_name": branchName,
		"city": city, "address_line": address, "timezone": tz,
	}, &created)
	if err != nil {
		return "", "", err
	}
	if status >= 300 {
		return "", "", &apiError{Status: status, Body: "create organization failed"}
	}
	return created.Organization.ID, created.Branch.ID, nil
}

func ensureServices(c *http.Client, base string, user authUser, orgID string, specs []serviceSpec) ([]string, error) {
	var me struct {
		Services []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"services"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/me/master", user.Token, nil, &me)
	byName := map[string]string{}
	for _, s := range me.Services {
		byName[strings.ToLower(s.Name)] = s.ID
	}

	ids := make([]string, 0, len(specs))
	for _, sp := range specs {
		if id, ok := byName[strings.ToLower(sp.Name)]; ok {
			ids = append(ids, id)
			continue
		}
		var created struct {
			ID string `json:"id"`
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/services", user.Token, map[string]any{
			"organization_id":  orgID,
			"name":             sp.Name,
			"category":         sp.Category,
			"duration_minutes": sp.Duration,
			"price_minor":      sp.Price,
			"attach_to_me":     true,
		}, &created)
		if err != nil {
			return nil, err
		}
		if status >= 300 {
			log.Printf("warn create service %q status=%d", sp.Name, status)
			continue
		}
		ids = append(ids, created.ID)
	}
	return ids, nil
}

// --- supplier / commerce ---

func seedSupplier(c *http.Client, base string, user authUser) (orgID string, productIDs []string, err error) {
	orgID, _, err = ensureOrg(c, base, user, "supplier", "Поставщик Профи (demo)", "Склад Москва", "Москва", "просп. Мира, 5", "Europe/Moscow")
	if err != nil {
		return "", nil, err
	}
	pub := true
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/organizations/"+orgID, user.Token, map[string]any{
		"published": pub, "description": "Демо-поставщик профессиональной косметики",
	}, nil)

	locID, err := ensureLocation(c, base, user, orgID, "Склад поставщика", "supplier")
	if err != nil {
		return "", nil, err
	}

	type prodSpec struct {
		Brand, Name, SKU, Unit, Volume string
		Price                          int64
	}
	wanted := []prodSpec{
		{Brand: "L'Oreal", Name: "Краска Majirel", SKU: "LOR-MAJ-001", Unit: "pcs", Volume: "50ml", Price: 89000},
		{Brand: "L'Oreal", Name: "Окислитель 9%", SKU: "LOR-OX-9", Unit: "pcs", Volume: "1000ml", Price: 65000},
		{Brand: "Kerastase", Name: "Шампунь Nutritive", SKU: "KER-NUT-SH", Unit: "pcs", Volume: "250ml", Price: 240000},
	}

	var existing struct {
		Items []struct {
			ID   string `json:"id"`
			SKU  string `json:"sku"`
			Name string `json:"name"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/products?organization_id="+orgID, user.Token, nil, &existing)
	bySKU := map[string]string{}
	for _, p := range existing.Items {
		bySKU[p.SKU] = p.ID
	}

	for _, w := range wanted {
		id := bySKU[w.SKU]
		if id == "" {
			var created struct {
				ID string `json:"id"`
			}
			status, err := doJSON(c, http.MethodPost, base+"/v1/commerce/products", user.Token, map[string]any{
				"organization_id": orgID,
				"brand":           w.Brand,
				"name":            w.Name,
				"sku":             w.SKU,
				"unit":            w.Unit,
				"volume_label":    w.Volume,
				"price_minor":     w.Price,
				"currency":        "RUB",
				"min_stock":       5,
				"published":       true,
				"description":     "Демо-товар для seed",
			}, &created)
			if err != nil {
				return "", nil, err
			}
			if status >= 300 {
				log.Printf("warn create product %s status=%d", w.SKU, status)
				continue
			}
			id = created.ID
		}
		productIDs = append(productIDs, id)
		// Stock so products look available.
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/stock/movements", user.Token, map[string]any{
			"location_id": locID, "product_id": id, "kind": "receipt", "qty": 50, "reason": "seed stock",
		}, nil)
	}
	return orgID, productIDs, nil
}

func ensureLocation(c *http.Client, base string, user authUser, orgID, name, kind string) (string, error) {
	var list struct {
		Items []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Kind string `json:"kind"`
		} `json:"items"`
	}
	status, err := doJSON(c, http.MethodGet, base+"/v1/commerce/locations?organization_id="+orgID, user.Token, nil, &list)
	if err != nil {
		return "", err
	}
	if status < 300 {
		for _, l := range list.Items {
			if l.Kind == kind || strings.EqualFold(l.Name, name) {
				return l.ID, nil
			}
		}
	}
	var created struct {
		ID string `json:"id"`
	}
	status, err = doJSON(c, http.MethodPost, base+"/v1/commerce/locations", user.Token, map[string]any{
		"organization_id": orgID, "name": name, "kind": kind,
	}, &created)
	if err != nil {
		return "", err
	}
	if status >= 300 {
		return "", &apiError{Status: status, Body: "create location failed"}
	}
	return created.ID, nil
}

// --- knowledge ---

func seedKnowledge(c *http.Client, base string, user authUser, orgID string) error {
	articles := []struct {
		Title, Category, Content string
	}{
		{
			Title:    "Основы колористики: тон и фон осветления",
			Category: "Колористика",
			Content:  "Краткий гид по уровням тона и фону осветления для демо базы знаний Zlobin Beauty.",
		},
		{
			Title:    "Протокол уходовых процедур",
			Category: "Процедуры",
			Content:  "Пошаговый протокол реконструкции волос: диагностика, нанесение, время выдержки, финальный уход.",
		},
		{
			Title:    "Как выбирать окислитель",
			Category: "Продукция",
			Content:  "Разница между 3%, 6% и 9% окислителями и рекомендации по совместимости с красками L'Oreal.",
		},
	}

	var list struct {
		Items []struct {
			Category string `json:"category"`
			Title    string `json:"title"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/knowledge", "", nil, &list)
	have := map[string]bool{}
	for _, it := range list.Items {
		have[strings.ToLower(it.Category+"|"+it.Title)] = true
	}

	pub := true
	for _, a := range articles {
		key := strings.ToLower(a.Category + "|" + a.Title)
		if have[key] {
			log.Printf("skip knowledge %q", a.Title)
			continue
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/knowledge", user.Token, map[string]any{
			"title": a.Title, "category": a.Category, "content": a.Content,
			"author_name": "Демо мастер", "organization_id": orgID, "published": pub,
		}, nil)
		if err != nil {
			return err
		}
		if status >= 300 {
			log.Printf("warn knowledge %q status=%d", a.Title, status)
		}
	}
	return nil
}

// --- appointments / client cards ---

func seedAppointments(c *http.Client, base string, client, master authUser, masterProfileID, serviceID string) (string, error) {
	if masterProfileID == "" || serviceID == "" {
		return "", fmt.Errorf("missing master profile or service")
	}

	// Prefer tomorrow or next weekday with free slots.
	startsAt, err := findSlot(c, base, master.ID, 60)
	if err != nil {
		return "", err
	}

	var appt struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	status, err := doJSON(c, http.MethodPost, base+"/v1/appointments", client.Token, map[string]any{
		"master_id": masterProfileID, "service_id": serviceID, "starts_at": startsAt,
	}, &appt)
	if err != nil {
		return "", err
	}
	if status >= 300 {
		// Maybe already booked for overlapping slot — try listing client's appointments.
		log.Printf("warn create appointment status=%d — checking existing", status)
		var mine struct {
			Items []struct {
				ID           string `json:"id"`
				Status       string `json:"status"`
				MasterUserID string `json:"master_user_id"`
			} `json:"items"`
		}
		_, _ = doJSON(c, http.MethodGet, base+"/v1/appointments/mine?role=client", client.Token, nil, &mine)
		for _, it := range mine.Items {
			if it.MasterUserID == master.ID && it.Status != "cancelled_by_client" && it.Status != "cancelled_by_master" {
				appt.ID = it.ID
				appt.Status = it.Status
				break
			}
		}
		if appt.ID == "" {
			return "", &apiError{Status: status, Body: "create appointment failed"}
		}
	}
	log.Printf("appointment %s status=%s", appt.ID, appt.Status)

	if appt.Status == "pending_confirmation" || appt.Status == "pending" || appt.Status == "" {
		st, _ := doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/confirm", master.Token, map[string]any{}, &appt)
		log.Printf("confirm appointment status_code=%d new_status=%s", st, appt.Status)
	}

	// Auto-confirm demo for client1 ↔ master1.
	_, _ = doJSON(c, http.MethodPut, base+"/v1/me/clients/"+client.ID+"/auto-confirm", master.Token, map[string]any{
		"auto_confirm": true,
	}, nil)
	log.Printf("ok auto-confirm client=%s master=%s", client.ID, master.ID)

	// Complete flow so a visit appears on the client card.
	if appt.Status != "completed" {
		_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/start", master.Token, map[string]any{}, &appt)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/complete", master.Token, map[string]any{}, &appt)
	}

	var card struct {
		ID string `json:"id"`
	}
	st, _ := doJSON(c, http.MethodGet, base+"/v1/client-cards/appointment/"+appt.ID, master.Token, nil, &card)
	if st < 300 && card.ID != "" {
		_, _ = doJSON(c, http.MethodPost, base+"/v1/client-cards/id/"+card.ID+"/formulas", master.Token, map[string]any{
			"name": "Демо формула seed", "brand": "L'Oreal",
			"components": []map[string]any{
				{"code": "7.1", "grams": 30},
				{"code": "7.3", "grams": 20},
			},
			"oxidizer": "6%", "ratio": "1:1.5",
			"comment": "Создано seed-скриптом",
		}, nil)
		log.Printf("ok formula on card=%s", card.ID)
	} else {
		log.Printf("warn client card not found for appointment %s", appt.ID)
	}

	return appt.ID, nil
}

func findSlot(c *http.Client, base, masterUserID string, durationMin int) (time.Time, error) {
	day := time.Now().UTC().AddDate(0, 0, 1)
	for i := 0; i < 14; i++ {
		d := day.AddDate(0, 0, i)
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			continue
		}
		date := d.Format("2006-01-02")
		url := fmt.Sprintf("%s/v1/masters/%s/slots?date=%s&duration_minutes=%d", base, masterUserID, date, durationMin)
		var slots struct {
			Items []struct {
				StartsAt time.Time `json:"starts_at"`
			} `json:"items"`
		}
		status, err := doJSON(c, http.MethodGet, url, "", nil, &slots)
		if err != nil {
			return time.Time{}, err
		}
		if status < 300 && len(slots.Items) > 0 {
			return slots.Items[0].StartsAt, nil
		}
	}
	return time.Time{}, fmt.Errorf("no free slots in next 14 days")
}

// --- supplier orders ---

func seedOrders(c *http.Client, base string, master, supplier authUser, buyerOrgID, _ string, productIDs []string) error {
	if len(productIDs) < 2 {
		return fmt.Errorf("need at least 2 products")
	}
	locID, err := ensureLocation(c, base, master, buyerOrgID, "Основной склад", "salon")
	if err != nil {
		return err
	}

	// Resolve supplier org id.
	var mine struct {
		Items []struct {
			Organization struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			} `json:"organization"`
		} `json:"items"`
	}
	_, err = doJSON(c, http.MethodGet, base+"/v1/organizations/mine", supplier.Token, nil, &mine)
	if err != nil {
		return err
	}
	var supplierOrgID string
	for _, it := range mine.Items {
		if it.Organization.Type == "supplier" {
			supplierOrgID = it.Organization.ID
			break
		}
	}
	if supplierOrgID == "" {
		return fmt.Errorf("supplier org not found")
	}

	var existing struct {
		Items []struct {
			ID      string `json:"id"`
			Status  string `json:"status"`
			Comment string `json:"comment"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/supplier-orders?organization_id="+buyerOrgID, master.Token, nil, &existing)
	haveNew, havePicking := false, false
	for _, o := range existing.Items {
		if strings.Contains(o.Comment, "[seed-new]") {
			haveNew = true
		}
		if strings.Contains(o.Comment, "[seed-flow]") || o.Status == "picking" || o.Status == "confirmed" {
			havePicking = true
		}
	}

	createOrder := func(comment string) (string, error) {
		var created struct {
			ID string `json:"id"`
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders", master.Token, map[string]any{
			"buyer_org_id":    buyerOrgID,
			"supplier_org_id": supplierOrgID,
			"location_id":     locID,
			"comment":         comment,
			"items": []map[string]any{
				{"product_id": productIDs[0], "qty": 2},
				{"product_id": productIDs[1], "qty": 1},
			},
		}, &created)
		if err != nil {
			return "", err
		}
		if status >= 300 {
			return "", &apiError{Status: status, Body: "create supplier order failed"}
		}
		return created.ID, nil
	}

	if !haveNew {
		id, err := createOrder("[seed-new] Демо заказ (new)")
		if err != nil {
			log.Printf("warn create new order: %v", err)
		} else {
			log.Printf("ok supplier order new id=%s", id)
		}
	} else {
		log.Printf("skip [seed-new] order — already exists")
	}

	if !havePicking {
		id, err := createOrder("[seed-flow] Демо заказ (confirmed→picking)")
		if err != nil {
			log.Printf("warn create flow order: %v", err)
			return nil
		}
		// Supplier transitions: new → confirmed → picking.
		st, _ := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+id+"/transition", supplier.Token, map[string]any{
			"status": "confirmed",
		}, nil)
		est := time.Now().UTC().AddDate(0, 0, 3)
		st2, _ := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+id+"/transition", supplier.Token, map[string]any{
			"status": "picking", "estimated_delivery_at": est,
		}, nil)
		log.Printf("ok supplier order flow id=%s confirmed=%d picking=%d", id, st, st2)
	} else {
		log.Printf("skip [seed-flow] order — already exists")
	}
	return nil
}

// --- HTTP helpers ---

func doJSON(c *http.Client, method, url, token string, body any, out any) (int, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, rdr)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if out != nil && len(raw) > 0 && resp.StatusCode < 300 {
		if err := json.Unmarshal(raw, out); err != nil {
			return resp.StatusCode, fmt.Errorf("decode %s: %w (body=%s)", url, err, truncate(string(raw), 200))
		}
	}
	// Non-2xx is not a transport error — callers branch on status.
	return resp.StatusCode, nil
}

func waitHealth(c *http.Client, base string) error {
	var last error
	for i := 0; i < 60; i++ {
		resp, err := c.Get(base + "/healthz")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 300 {
				return nil
			}
			last = fmt.Errorf("status %d", resp.StatusCode)
		} else {
			last = err
		}
		time.Sleep(2 * time.Second)
	}
	return last
}

func envOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func fatal(format string, args ...any) {
	log.Printf("error: "+format, args...)
	os.Exit(1)
}
