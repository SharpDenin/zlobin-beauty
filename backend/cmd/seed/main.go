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

	_ "time/tzdata" // embed zoneinfo for Windows hosts without system tz data
)

const defaultPassword = "Password123!"

func main() {
	base := strings.TrimRight(envOr("GATEWAY_URL", "http://localhost:8090"), "/")
	password := envOr("SEED_PASSWORD", defaultPassword)
	client := &http.Client{Timeout: 30 * time.Second}

	log.Printf("seed: gateway=%s", base)
	if err := waitHealth(client, base); err != nil {
		fatal("gateway health: %v", err)
	}

	accounts := []accountSpec{
		{Email: "client1@demo.local", Name: "Клиент Один", Role: "client", City: "Красноярск"},
		{Email: "client2@demo.local", Name: "Клиент Два", Role: "client"},
		{Email: "client3@demo.local", Name: "Клиент Три", Role: "client", City: "Москва"},
		{Email: "master1@demo.local", Name: "Мастер Анна", Role: "master"},
		{Email: "master2@demo.local", Name: "Мастер Иван", Role: "master"},
		{Email: "master3@demo.local", Name: "Мастер Ольга", Role: "master"},
		{Email: "master4@demo.local", Name: "Мастер Дмитрий", Role: "master"},
		{Email: "admin1@demo.local", Name: "Админ Салона", Role: "salon_admin"},
		{Email: "supplier1@demo.local", Name: "Поставщик Профи", Role: "supplier"},
		{Email: "supplier2@demo.local", Name: "Поставщик БьютиЛайн", Role: "supplier"},
		{Email: "rep1@demo.local", Name: "Представитель Елена", Role: "supplier_rep", City: "Красноярск"},
		{Email: "rep2@demo.local", Name: "Представитель Павел", Role: "supplier_rep", City: "Москва"},
	}
	users := map[string]authUser{}
	for _, a := range accounts {
		u, err := loginOrRegister(client, base, a, password)
		if err != nil {
			fatal("auth %s: %v", a.Email, err)
		}
		if a.City != "" {
			if err := patchUserCity(client, base, u, a.City); err != nil {
				log.Printf("warn patch city %s: %v", a.Email, err)
			}
		}
		users[a.Email] = u
		log.Printf("ok account %s id=%s roles=%v", a.Email, u.ID, u.Roles)
	}

	master1 := users["master1@demo.local"]
	master2 := users["master2@demo.local"]
	master3 := users["master3@demo.local"]
	master4 := users["master4@demo.local"]
	supplier1 := users["supplier1@demo.local"]
	supplier2 := users["supplier2@demo.local"]
	client1 := users["client1@demo.local"]

	m1Org, m1Branch, m1Profile, m1Service, err := seedMaster(client, base, master1, masterSeed{
		OrgName: "Салон Анны (demo)", BranchName: "Красноярск центр",
		City: "Красноярск", Address: "ул. Ленина, 50", Phone: "+79001112233", Timezone: "Asia/Krasnoyarsk",
		Display: "Анна Колористика", Bio: "Мастер-колорист в Красноярске. Демо-профиль для Salon-X.",
		Specs: []string{"колористика", "стрижки"}, Experience: 7, Education: "Академия колористики",
		WorkType: "owner",
		Services: []serviceSpec{
			{Name: "Стрижка", Category: "стрижки", Description: "Женская стрижка с консультацией по форме.", Duration: 60, Price: 200000},
			{Name: "Окрашивание", Category: "колористика", Description: "Полное окрашивание с подбором формулы.", Duration: 180, Price: 500000},
			{Name: "Уход", Category: "уход", Description: "Восстанавливающий уход после окрашивания.", Duration: 90, Price: 350000},
		},
	})
	if err != nil {
		fatal("master1: %v", err)
	}
	log.Printf("ok master1 city=Красноярск tz=Asia/Krasnoyarsk org=%s branch=%s profile=%s service=%s work_type=owner", m1Org, m1Branch, m1Profile, m1Service)
	if err := seedFixedWindowWorkshop(client, base, master1, m1Org, m1Branch); err != nil {
		log.Printf("warn fixed_window workshop: %v", err)
	}

	_, _, _, _, err = seedMaster(client, base, master2, masterSeed{
		OrgName: "Салон Ивана (demo)", BranchName: "Новосибирск юг",
		City: "Новосибирск", Address: "ул. Красный проспект, 25", Phone: "+79004445566", Timezone: "Asia/Novosibirsk",
		Display: "Иван Стилист", Bio: "Стилист и мастер укладок в Новосибирске. Демо «другой город» для поиска.",
		Specs: []string{"стрижки", "укладки"}, Experience: 5, Education: "Школа стиля",
		WorkType: "renter",
		Services: []serviceSpec{
			{Name: "Мужская стрижка", Category: "стрижки", Description: "Классическая мужская стрижка машинкой и ножницами.", Duration: 45, Price: 150000},
			{Name: "Укладка", Category: "укладки", Description: "Вечерняя или повседневная укладка феном.", Duration: 60, Price: 250000},
			{Name: "Борода", Category: "барбер", Description: "Оформление бороды и контура.", Duration: 30, Price: 100000},
		},
	})
	if err != nil {
		fatal("master2: %v", err)
	}
	log.Printf("ok master2 city=Новосибирск tz=Asia/Novosibirsk work_type=renter")

	_, _, _, _, err = seedMaster(client, base, master3, masterSeed{
		OrgName: "Салон Ольги (demo)", BranchName: "Москва запад",
		City: "Москва", Address: "Кутузовский просп., 12", Phone: "+79007778899", Timezone: "Europe/Moscow",
		Display: "Ольга Nail Art", Bio: "Мастер маникюра и педикюра, сотрудник салона.",
		Specs: []string{"маникюр", "педикюр"}, Experience: 4, Education: "Nail Academy",
		WorkType: "employee",
		Services: []serviceSpec{
			{Name: "Маникюр", Category: "маникюр", Description: "Классический или аппаратный маникюр с покрытием.", Duration: 75, Price: 220000},
			{Name: "Педикюр", Category: "педикюр", Description: "Эстетический педикюр с уходом за стопой.", Duration: 90, Price: 280000},
			{Name: "Дизайн ногтей", Category: "маникюр", Description: "Художественный дизайн или стемпинг.", Duration: 45, Price: 120000},
			{Name: "Снятие покрытия", Category: "маникюр", Description: "Аккуратное снятие гель-лака.", Duration: 30, Price: 80000},
		},
	})
	if err != nil {
		fatal("master3: %v", err)
	}
	log.Printf("ok master3 city=Москва tz=Europe/Moscow work_type=employee")

	_, _, _, _, err = seedMaster(client, base, master4, masterSeed{
		OrgName: "Кабинет Дмитрия (demo)", BranchName: "Красноярск север",
		City: "Красноярск", Address: "ул. Мира, 12", Phone: "+79001234567", Timezone: "Asia/Krasnoyarsk",
		Display: "Дмитрий Бровист", Bio: "Независимый мастер бровей и ресниц в Красноярске.",
		Specs: []string{"брови", "ресницы"}, Experience: 6, Education: "Brow School",
		WorkType: "independent",
		Services: []serviceSpec{
			{Name: "Коррекция бровей", Category: "брови", Description: "Форма бровей под тип лица.", Duration: 40, Price: 180000},
			{Name: "Окрашивание бровей", Category: "брови", Description: "Стойкое окрашивание с подбором оттенка.", Duration: 50, Price: 200000},
			{Name: "Ламинирование ресниц", Category: "ресницы", Description: "Ламинирование и питание ресниц.", Duration: 70, Price: 320000},
		},
	})
	if err != nil {
		fatal("master4: %v", err)
	}
	log.Printf("ok master4 city=Красноярск tz=Asia/Krasnoyarsk work_type=independent")

	sup1Org, products1, err := seedSupplier(client, base, supplier1, supplierSeed{
		OrgName:      "Поставщик Профи (demo)",
		BranchName:   "Склад Москва",
		City:         "Москва",
		Address:      "просп. Мира, 5",
		Phone:        "+79005556677",
		Timezone:     "Europe/Moscow",
		Description:  "Профессиональная косметика для салонов: краски, уход, стайлинг.",
		DeliveryNote: "Доставка 2–5 дней по Москве",
		MinPublished: 8,
		Products:     supplier1Products(),
	})
	if err != nil {
		fatal("supplier1: %v", err)
	}
	log.Printf("ok supplier1 org=%s products=%d", sup1Org, len(products1))

	sup2Org, products2, err := seedSupplier(client, base, supplier2, supplierSeed{
		OrgName:      "Поставщик БьютиЛайн (demo)",
		BranchName:   "Склад Химки",
		City:         "Химки",
		Address:      "ул. Складская, 3",
		Phone:        "+79008889900",
		Timezone:     "Europe/Moscow",
		Description:  "Дистрибьютор уходовой и декоративной профессиональной косметики.",
		DeliveryNote: "Доставка 3–7 дней по Москве и области",
		MinPublished: 4,
		Products:     supplier2Products(),
	})
	if err != nil {
		fatal("supplier2: %v", err)
	}
	log.Printf("ok supplier2 org=%s products=%d", sup2Org, len(products2))

	rep1 := users["rep1@demo.local"]
	rep2 := users["rep2@demo.local"]
	if err := seedRepresentatives(client, base, supplier1, sup1Org, m1Branch, rep1, rep2); err != nil {
		log.Printf("warn representatives: %v", err)
	} else {
		log.Printf("ok supplier representatives")
	}

	if err := seedKnowledge(client, base, supplier1, "Поставщик Профи", sup1Org); err != nil {
		log.Printf("warn knowledge: %v", err)
	} else {
		log.Printf("ok knowledge articles (supplier-authored)")
	}

	apptID, err := seedAppointments(client, base, client1, master1, m1Profile, m1Service)
	if err != nil {
		log.Printf("warn appointments: %v", err)
	} else if apptID != "" {
		log.Printf("ok appointment=%s", apptID)
	}

	if err := seedOrders(client, base, master1, supplier1, m1Org, m1Branch, products1); err != nil {
		log.Printf("warn orders: %v", err)
	} else {
		log.Printf("ok supplier orders")
	}

	if err := seedRecurring(client, base, master1, supplier1, m1Org, m1Branch, sup1Org, products1); err != nil {
		log.Printf("warn recurring: %v", err)
	} else {
		log.Printf("ok recurring supply")
	}

	log.Printf("seed complete")
	log.Printf("demo accounts password=%s", password)
	log.Printf("Open /cosmetics — suppliers appear as cards")
	log.Printf("search demo: default city Красноярск shows Anna+Dmitry; Новосибирск (Ivan) needs include_other_cities")
	log.Printf("--- demo accounts ---")
	log.Printf("client1@demo.local city=Красноярск / client2@demo.local   role=client")
	log.Printf("master1@demo.local city=Красноярск Asia/Krasnoyarsk      work_type=owner (+ fixed_window МК)")
	log.Printf("master2@demo.local city=Новосибирск Asia/Novosibirsk     work_type=renter (other city)")
	log.Printf("master3@demo.local city=Москва Europe/Moscow             work_type=employee")
	log.Printf("master4@demo.local city=Красноярск Asia/Krasnoyarsk      work_type=independent")
	log.Printf("supplier1@demo.local org=%s", truncate(sup1Org, 36))
	log.Printf("supplier2@demo.local org=%s", truncate(sup2Org, 36))
}

// --- types ---

type accountSpec struct {
	Email string
	Name  string
	Role  string
	City  string // optional; applied via PATCH /v1/auth/me (register has no city field)
}

type authUser struct {
	Token string
	ID    string
	Roles []string
}

type serviceSpec struct {
	Name, Category, Description string
	Duration                    int
	Price                       int64
	BookingMode                 string // optional: flexible | fixed_window
}

type masterSeed struct {
	OrgName, BranchName, City, Address, Phone, Timezone string
	Display, Bio, Education, WorkType                   string
	Specs                                               []string
	Experience                                          int
	Services                                            []serviceSpec
}

type prodSpec struct {
	Brand, Name, SKU, Unit, Volume, Category, Description string
	Price                                                 int64
	Published, ForSale                                    bool
	DeliveryDays                                          int
	Audience                                              string
}

type supplierSeed struct {
	OrgName, BranchName, City, Address, Phone, Timezone string
	Description, DeliveryNote                           string
	MinPublished                                        int
	Products                                            []prodSpec
}

type apiError struct {
	Status int
	Body   string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.Status, truncate(e.Body, 300))
}

func supplier1Products() []prodSpec {
	return []prodSpec{
		{Brand: "L'Oreal", Name: "Краска Majirel", SKU: "S1-LOR-MAJ-001", Unit: "pcs", Volume: "50ml", Category: "краска", Description: "Перманентная крем-краска Majirel", Price: 89000, Published: true, ForSale: true, DeliveryDays: 2},
		{Brand: "L'Oreal", Name: "Окислитель 9%", SKU: "S1-LOR-OX-9", Unit: "pcs", Volume: "1000ml", Category: "окислитель", Description: "Оксидант 9% для окрашивания", Price: 65000, Published: true, ForSale: true, DeliveryDays: 2},
		{Brand: "L'Oreal", Name: "Шампунь Absolut Repair", SKU: "S1-LOR-AR-SH", Unit: "pcs", Volume: "300ml", Category: "шампунь", Description: "Восстанавливающий шампунь", Price: 185000, Published: true, ForSale: true, DeliveryDays: 3},
		{Brand: "Wella", Name: "Koleston Perfect", SKU: "S1-WEL-KOL-001", Unit: "pcs", Volume: "60ml", Category: "краска", Description: "Стойкая крем-краска Koleston", Price: 92000, Published: true, ForSale: true, DeliveryDays: 3},
		{Brand: "Wella", Name: "Oil Reflections шампунь", SKU: "S1-WEL-OR-SH", Unit: "pcs", Volume: "250ml", Category: "шампунь", Description: "Блеск и мягкость волос", Price: 210000, Published: true, ForSale: false, DeliveryDays: 4},
		{Brand: "Olaplex", Name: "No.3 Hair Perfector", SKU: "S1-OLA-N3", Unit: "pcs", Volume: "100ml", Category: "уход", Description: "Домашний уход для восстановления связей", Price: 320000, Published: true, ForSale: true, DeliveryDays: 5},
		{Brand: "Olaplex", Name: "No.0 Intensive Bond", SKU: "S1-OLA-N0", Unit: "pcs", Volume: "155ml", Category: "уход", Description: "Интенсивный праймер перед No.3", Price: 290000, Published: false, ForSale: true, DeliveryDays: 5},
		{Brand: "Estel", Name: "Essex краска", SKU: "S1-EST-ESX-001", Unit: "pcs", Volume: "60ml", Category: "краска", Description: "Крем-краска Essex", Price: 42000, Published: true, ForSale: true, DeliveryDays: 1},
		{Brand: "Estel", Name: "Curex Therapy маска", SKU: "S1-EST-CTX-MSK", Unit: "pcs", Volume: "500ml", Category: "маска", Description: "Терапевтическая маска для повреждённых волос", Price: 78000, Published: true, ForSale: true, DeliveryDays: 2},
		{Brand: "Estel", Name: "De Luxe окислитель 6%", SKU: "S1-EST-DLX-OX6", Unit: "pcs", Volume: "1000ml", Category: "окислитель", Description: "Оксигент 6% De Luxe", Price: 38000, Published: false, ForSale: false, DeliveryDays: 7},
		{Brand: "L'Oreal", Name: "Pro Fiber концентрат", SKU: "S1-LOR-PRO-FIB", Unit: "pcs", Volume: "150ml", Category: "уход", Description: "Только для мастеров: профессиональный концентрат", Price: 410000, Published: true, ForSale: true, DeliveryDays: 2, Audience: "professional_only"},
		{Brand: "Wella", Name: "EIMI Super Set", SKU: "S1-WEL-EIMI-SS", Unit: "pcs", Volume: "300ml", Category: "стайлинг", Description: "Лак сильной фиксации", Price: 145000, Published: true, ForSale: true, DeliveryDays: 4},
		{Brand: "Olaplex", Name: "No.6 Bond Smoother", SKU: "S1-OLA-N6", Unit: "pcs", Volume: "100ml", Category: "уход", Description: "Крем-несмывашка для гладкости", Price: 280000, Published: true, ForSale: true, DeliveryDays: 6},
	}
}

func supplier2Products() []prodSpec {
	return []prodSpec{
		{Brand: "L'Oreal", Name: "Dia Richesse", SKU: "S2-LOR-DIA-001", Unit: "pcs", Volume: "50ml", Category: "краска", Description: "Тонирующая краска Dia Richesse", Price: 76000, Published: true, ForSale: true, DeliveryDays: 3},
		{Brand: "Wella", Name: "Fusion маска", SKU: "S2-WEL-FUS-MSK", Unit: "pcs", Volume: "150ml", Category: "маска", Description: "Интенсивная маска Fusion", Price: 265000, Published: true, ForSale: true, DeliveryDays: 4},
		{Brand: "Estel", Name: "Otium Aqua шампунь", SKU: "S2-EST-OTA-SH", Unit: "pcs", Volume: "250ml", Category: "шампунь", Description: "Увлажняющий шампунь Otium Aqua", Price: 69000, Published: true, ForSale: true, DeliveryDays: 2},
		{Brand: "Olaplex", Name: "No.4 Bond Maintenance", SKU: "S2-OLA-N4", Unit: "pcs", Volume: "250ml", Category: "шампунь", Description: "Шампунь для поддержания связей", Price: 310000, Published: true, ForSale: false, DeliveryDays: 5},
		{Brand: "L'Oreal", Name: "Serie Expert Blow-Dry", SKU: "S2-LOR-SE-BD", Unit: "pcs", Volume: "150ml", Category: "стайлинг", Description: "Термозащитный крем", Price: 198000, Published: false, ForSale: true, DeliveryDays: 7},
	}
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
	case "supplier_rep":
		reg["as_supplier_rep"] = true
	case "salon_admin":
		reg["as_salon_admin"] = true
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

func patchUserCity(c *http.Client, base string, user authUser, city string) error {
	status, err := doJSON(c, http.MethodPatch, base+"/v1/auth/me", user.Token, map[string]any{
		"city": city,
	}, nil)
	if err != nil {
		return err
	}
	if status >= 300 {
		return &apiError{Status: status, Body: "PATCH /v1/auth/me city failed"}
	}
	return nil
}

// --- master / org ---

func seedMaster(c *http.Client, base string, user authUser, cfg masterSeed) (orgID, branchID, profileID, firstServiceID string, err error) {
	orgID, branchID, err = ensureOrg(c, base, user, "salon", cfg.OrgName, cfg.BranchName, cfg.City, cfg.Address, cfg.Timezone)
	if err != nil {
		return "", "", "", "", err
	}

	// Branch readiness requires phone/city/address/timezone; pickup_enabled for supplier-order destinations.
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/branches/"+branchID, user.Token, map[string]any{
		"phone": cfg.Phone, "city": cfg.City, "address_line": cfg.Address, "timezone": cfg.Timezone,
		"name": cfg.BranchName, "pickup_enabled": true,
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
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/branches/"+branchID, user.Token, map[string]any{
		"published": pub, "pickup_enabled": true,
	}, nil)
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/organizations/"+orgID, user.Token, map[string]any{
		"published": pub, "description": cfg.Bio,
	}, nil)

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
	body := map[string]any{
		"organization_id":  orgID,
		"branch_id":        branchID,
		"display_name":     cfg.Display,
		"bio":              cfg.Bio,
		"specializations":  cfg.Specs,
		"city":             cfg.City,
		"experience_years": cfg.Experience,
		"education":        cfg.Education,
		"published":        published,
	}
	if cfg.WorkType != "" {
		body["work_type"] = cfg.WorkType
	}
	status, err := doJSON(c, http.MethodPut, base+"/v1/me/master", user.Token, body, &resp)
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
				// Refresh name/description fields on re-seed when possible.
				_, _ = doJSON(c, http.MethodPatch, base+"/v1/organizations/"+orgID, user.Token, map[string]any{
					"name": name,
				}, nil)
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
		payload := map[string]any{
			"organization_id":  orgID,
			"name":             sp.Name,
			"category":         sp.Category,
			"duration_minutes": sp.Duration,
			"price_minor":      sp.Price,
			"attach_to_me":     true,
		}
		if sp.Description != "" {
			payload["description"] = sp.Description
		}
		if sp.BookingMode != "" {
			payload["booking_mode"] = sp.BookingMode
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/services", user.Token, payload, &created)
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

// seedFixedWindowWorkshop creates Anna's author workshop + one Krasnoyarsk occurrence (~next week 14:00–18:00).
func seedFixedWindowWorkshop(c *http.Client, base string, user authUser, orgID, branchID string) error {
	const workshopName = "Авторский мастер-класс по окрашиванию"
	ids, err := ensureServices(c, base, user, orgID, []serviceSpec{{
		Name: workshopName, Category: "обучение",
		Description: "Групповой мастер-класс по авторским техникам окрашивания. Запись на фиксированное окно.",
		Duration: 240, Price: 850000, BookingMode: "fixed_window",
	}})
	if err != nil {
		return err
	}
	if len(ids) == 0 || ids[0] == "" {
		return fmt.Errorf("workshop service not created")
	}
	serviceID := ids[0]

	var existing struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/services/"+serviceID+"/occurrences", user.Token, nil, &existing)
	if len(existing.Items) > 0 {
		log.Printf("skip workshop occurrence — already %d for service=%s", len(existing.Items), serviceID)
		return nil
	}

	loc, err := time.LoadLocation("Asia/Krasnoyarsk")
	if err != nil {
		return fmt.Errorf("load Asia/Krasnoyarsk: %w", err)
	}
	now := time.Now().In(loc)
	day := now.AddDate(0, 0, 7)
	// Prefer a weekday for demo; skip weekend if next week lands on Sat/Sun.
	for day.Weekday() == time.Saturday || day.Weekday() == time.Sunday {
		day = day.AddDate(0, 0, 1)
	}
	startsLocal := time.Date(day.Year(), day.Month(), day.Day(), 14, 0, 0, 0, loc)
	endsLocal := startsLocal.Add(4 * time.Hour)

	var created struct {
		ID string `json:"id"`
	}
	status, err := doJSON(c, http.MethodPost, base+"/v1/services/"+serviceID+"/occurrences", user.Token, map[string]any{
		"branch_id":  branchID,
		"starts_at":  startsLocal.UTC().Format(time.RFC3339),
		"ends_at":    endsLocal.UTC().Format(time.RFC3339),
		"timezone":   "Asia/Krasnoyarsk",
		"capacity":   1,
		"title":      workshopName,
		"note":       "Демо fixed_window occurrence (seed)",
	}, &created)
	if err != nil {
		return err
	}
	if status >= 300 {
		return &apiError{Status: status, Body: "create workshop occurrence failed"}
	}
	log.Printf("ok fixed_window workshop service=%s occurrence=%s starts_local=%s", serviceID, created.ID, startsLocal.Format(time.RFC3339))
	return nil
}

// --- supplier / commerce ---

func seedSupplier(c *http.Client, base string, user authUser, cfg supplierSeed) (orgID string, productIDs []string, err error) {
	orgID, branchID, err := ensureOrg(c, base, user, "supplier", cfg.OrgName, cfg.BranchName, cfg.City, cfg.Address, cfg.Timezone)
	if err != nil {
		return "", nil, err
	}

	// Satisfy branch readiness checklist before publish.
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/branches/"+branchID, user.Token, map[string]any{
		"name": cfg.BranchName, "phone": cfg.Phone, "city": cfg.City,
		"address_line": cfg.Address, "timezone": cfg.Timezone,
	}, nil)

	pub := true
	stBranch, _ := doJSON(c, http.MethodPatch, base+"/v1/branches/"+branchID, user.Token, map[string]any{"published": pub}, nil)
	if stBranch >= 300 {
		log.Printf("warn publish supplier branch status=%d", stBranch)
	}

	stOrg, _ := doJSON(c, http.MethodPatch, base+"/v1/organizations/"+orgID, user.Token, map[string]any{
		"name": cfg.OrgName, "description": cfg.Description,
		"delivery_note": cfg.DeliveryNote, "published": pub,
	}, nil)
	if stOrg >= 300 {
		log.Printf("warn publish supplier org status=%d — retry without published", stOrg)
		_, _ = doJSON(c, http.MethodPatch, base+"/v1/organizations/"+orgID, user.Token, map[string]any{
			"name": cfg.OrgName, "description": cfg.Description, "delivery_note": cfg.DeliveryNote,
		}, nil)
		stOrg2, _ := doJSON(c, http.MethodPatch, base+"/v1/organizations/"+orgID, user.Token, map[string]any{"published": pub}, nil)
		if stOrg2 >= 300 {
			log.Printf("warn supplier org still unpublished status=%d", stOrg2)
		}
	}

	locID, err := ensureLocation(c, base, user, orgID, "Склад поставщика", "supplier")
	if err != nil {
		return "", nil, err
	}

	var existing struct {
		Items []struct {
			ID        string `json:"id"`
			SKU       string `json:"sku"`
			Name      string `json:"name"`
			Published bool   `json:"published"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/products?organization_id="+orgID, user.Token, nil, &existing)

	publishedCount := 0
	bySKU := map[string]string{}
	for _, p := range existing.Items {
		bySKU[p.SKU] = p.ID
		productIDs = append(productIDs, p.ID)
		if p.Published {
			publishedCount++
		}
	}

	if cfg.MinPublished > 0 && publishedCount >= cfg.MinPublished {
		log.Printf("skip product create for org=%s — already %d published (need %d)", orgID, publishedCount, cfg.MinPublished)
		return orgID, uniqueStrings(productIDs), nil
	}

	catIDs := listProductCategoryIDs(c, base, user)

	for _, w := range cfg.Products {
		id := bySKU[w.SKU]
		if id == "" {
			payload := map[string]any{
				"organization_id": orgID,
				"brand":           w.Brand,
				"name":            w.Name,
				"sku":             w.SKU,
				"unit":            w.Unit,
				"volume_label":    w.Volume,
				"price_minor":     w.Price,
				"currency":        "RUB",
				"min_stock":       5,
				"published":       w.Published,
				"for_sale":        w.ForSale,
				"delivery_days":   w.DeliveryDays,
				"description":     w.Description,
			}
			if w.Audience != "" {
				payload["audience"] = w.Audience
			}
			if catID := catIDs[strings.ToLower(w.Category)]; catID != "" {
				payload["category_id"] = catID
			}
			var created struct {
				ID string `json:"id"`
			}
			status, err := doJSON(c, http.MethodPost, base+"/v1/commerce/products", user.Token, payload, &created)
			if err != nil {
				return "", nil, err
			}
			if status >= 300 {
				log.Printf("warn create product %s status=%d", w.SKU, status)
				continue
			}
			id = created.ID
			bySKU[w.SKU] = id
			productIDs = append(productIDs, id)
		}
		// Stock so products look available.
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/stock/movements", user.Token, map[string]any{
			"location_id": locID, "product_id": id, "kind": "receipt", "qty": 50, "reason": "seed stock",
		}, nil)
	}
	return orgID, uniqueStrings(productIDs), nil
}

func listProductCategoryIDs(c *http.Client, base string, user authUser) map[string]string {
	var list struct {
		Items []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Slug string `json:"slug"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/product-categories", user.Token, nil, &list)
	out := map[string]string{}
	for _, it := range list.Items {
		out[strings.ToLower(it.Name)] = it.ID
		out[strings.ToLower(it.Slug)] = it.ID
	}
	return out
}

func seedRepresentatives(c *http.Client, base string, supplier authUser, orgID, salonBranchID string, rep1, rep2 authUser) error {
	if orgID == "" || rep1.ID == "" {
		return fmt.Errorf("missing supplier or rep")
	}
	var created struct {
		ID string `json:"id"`
	}
	status, err := doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/representatives", supplier.Token, map[string]any{
		"user_id": rep1.ID, "city": "Красноярск", "territory": "Красноярск",
		"salon_branch_ids": []string{salonBranchID},
	}, &created)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("create rep1 status %d", status)
	}
	repID := created.ID
	if rep2.ID != "" {
		_, _ = doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/representatives", supplier.Token, map[string]any{
			"user_id": rep2.ID, "city": "Москва", "territory": "Москва",
		}, &created)
	}
	if repID != "" {
		_, _ = doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/tasks", supplier.Token, map[string]any{
			"representative_id": repID,
			"title":             "Визит в салон Анны",
			"description":       "Показать новинки L'Oreal и снять заказ.",
			"branch_id":         salonBranchID,
			"priority":          "high",
		}, nil)
	}
	return nil
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

func seedKnowledge(c *http.Client, base string, user authUser, authorName, orgID string) error {
	docJSON := `{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Заголовок"}]},{"type":"paragraph","content":[{"type":"text","text":"Текст статьи"}]}]}`
	articles := []struct {
		Title, Category, Brand, Content, ContentFormat string
	}{
		{
			Title: "Основы колористики: тон и фон осветления", Category: "Колористика", Brand: "L'Oreal",
			Content: "Краткий гид по уровням тона и фону осветления для демо базы знаний Zlobin Beauty.",
			ContentFormat: "plain",
		},
		{
			Title: "Протокол уходовых процедур", Category: "Процедуры", Brand: "Olaplex",
			Content: "Пошаговый протокол реконструкции волос: диагностика, нанесение, время выдержки, финальный уход.",
			ContentFormat: "plain",
		},
		{
			Title: "Как выбирать окислитель", Category: "Продукция", Brand: "Wella",
			Content: "Разница между 3%, 6% и 9% окислителями и рекомендации по совместимости с красками.",
			ContentFormat: "plain",
		},
		{
			Title: "Работа с блондом без пересушивания", Category: "Колористика", Brand: "Estel",
			Content: "Практика поэтапного осветления, контроль фонов и защита структуры волос.",
			ContentFormat: "plain",
		},
		{
			Title: "Домашний уход после салона", Category: "Уход", Brand: "Olaplex",
			Content: "Какие продукты рекомендовать клиенту после окрашивания и как объяснить схему применения.",
			ContentFormat: "plain",
		},
		{
			Title: "Стайлинг: фиксация без жёсткости", Category: "Стайлинг", Brand: "Wella",
			Content: "Подбор средств фиксации под тип волос и желаемый результат укладки.",
			ContentFormat: "plain",
		},
		{
			Title: "Rich-док: формула окрашивания", Category: "Колористика", Brand: "L'Oreal",
			Content: docJSON,
			ContentFormat: "doc_json",
		},
		{Title: "Кислотный уход vs протеиновый", Category: "Уход", Brand: "Olaplex", Content: docJSON, ContentFormat: "doc_json"},
		{Title: "Коррекция цвета после домашнего окрашивания", Category: "Колористика", Brand: "Wella", Content: docJSON, ContentFormat: "doc_json"},
		{Title: "Санитарные нормы рабочего места", Category: "Салон", Brand: "Salon-X", Content: docJSON, ContentFormat: "doc_json"},
		{Title: "Подбор окислителя для седины", Category: "Продукция", Brand: "Estel", Content: docJSON, ContentFormat: "doc_json"},
		{Title: "Летний уход: UV-защита волос", Category: "Уход", Brand: "L'Oreal", Content: docJSON, ContentFormat: "doc_json"},
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
		payload := map[string]any{
			"title": a.Title, "category": a.Category, "content": a.Content, "brand": a.Brand,
			"author_name": authorName, "organization_id": orgID, "published": pub,
		}
		if a.ContentFormat != "" {
			payload["content_format"] = a.ContentFormat
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/knowledge", user.Token, payload, nil)
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

func seedOrders(c *http.Client, base string, master, supplier authUser, buyerOrgID, destBranchID string, productIDs []string) error {
	if len(productIDs) < 2 {
		return fmt.Errorf("need at least 2 products")
	}
	if destBranchID == "" {
		return fmt.Errorf("destination_branch_id is required for seed orders")
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
	have := map[string]bool{}
	for _, o := range existing.Items {
		switch {
		case strings.Contains(o.Comment, "[seed-new]"):
			have["new"] = true
		case strings.Contains(o.Comment, "[seed-flow]"):
			have["picking"] = true
		case strings.Contains(o.Comment, "[seed-transit]"):
			have["transit"] = true
		case strings.Contains(o.Comment, "[seed-delivered]"):
			have["delivered"] = true
		}
	}

	createOrder := func(comment string) (string, error) {
		var created struct {
			ID string `json:"id"`
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders", master.Token, map[string]any{
			"buyer_org_id":          buyerOrgID,
			"supplier_org_id":       supplierOrgID,
			"location_id":           locID,
			"destination_branch_id": destBranchID,
			"payment_method":        "bank_transfer",
			"comment":               comment,
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

	transition := func(id, status string, est *time.Time) int {
		body := map[string]any{"status": status}
		if est != nil {
			body["estimated_delivery_at"] = *est
		}
		st, _ := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+id+"/transition", supplier.Token, body, nil)
		return st
	}

	scheduleDelivery := func(id string) int {
		windowStart := time.Now().UTC().AddDate(0, 0, 2).Truncate(time.Hour)
		windowEnd := windowStart.Add(3 * time.Hour)
		st, _ := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+id+"/delivery/schedule", supplier.Token, map[string]any{
			"window_start":        windowStart,
			"window_end":          windowEnd,
			"planned_delivery_at": windowStart,
			"recipient_name":      "Анна",
			"recipient_phone":     "+79001112233",
			"comment":             "seed delivery window",
		}, nil)
		return st
	}

	markPaid := func(id string) int {
		st, _ := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+id+"/mark-paid", supplier.Token, map[string]any{}, nil)
		return st
	}

	if !have["new"] {
		id, err := createOrder("[seed-new] Демо заказ (new)")
		if err != nil {
			log.Printf("warn create new order: %v", err)
		} else {
			log.Printf("ok supplier order new id=%s dest=%s", id, truncate(destBranchID, 36))
		}
	} else {
		log.Printf("skip [seed-new] order — already exists")
	}

	if !have["picking"] {
		id, err := createOrder("[seed-flow] Демо заказ (confirmed→picking)")
		if err != nil {
			log.Printf("warn create flow order: %v", err)
		} else {
			est := time.Now().UTC().AddDate(0, 0, 3)
			st1 := transition(id, "confirmed", nil)
			st2 := transition(id, "picking", &est)
			stPay := markPaid(id)
			log.Printf("ok supplier order flow id=%s confirmed=%d picking=%d mark_paid=%d", id, st1, st2, stPay)
		}
	} else {
		log.Printf("skip [seed-flow] order — already exists")
	}

	if !have["transit"] {
		id, err := createOrder("[seed-transit] Демо заказ (→in_transit)")
		if err != nil {
			log.Printf("warn create transit order: %v", err)
		} else {
			est := time.Now().UTC().AddDate(0, 0, 2)
			_ = transition(id, "confirmed", nil)
			_ = transition(id, "picking", &est)
			stSched := scheduleDelivery(id)
			st := transition(id, "in_transit", &est)
			log.Printf("ok supplier order transit id=%s schedule=%d status_code=%d", id, stSched, st)
		}
	} else {
		log.Printf("skip [seed-transit] order — already exists")
	}

	if !have["delivered"] {
		id, err := createOrder("[seed-delivered] Демо заказ (→delivered)")
		if err != nil {
			log.Printf("warn create delivered order: %v", err)
		} else {
			est := time.Now().UTC().AddDate(0, 0, 1)
			_ = transition(id, "confirmed", nil)
			_ = transition(id, "picking", &est)
			_ = scheduleDelivery(id)
			_ = transition(id, "in_transit", &est)
			st := transition(id, "delivered", nil)
			log.Printf("ok supplier order delivered id=%s status_code=%d", id, st)
		}
	} else {
		log.Printf("skip [seed-delivered] order — already exists")
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

func seedRecurring(c *http.Client, base string, master, supplier authUser, buyerOrgID, pickupBranchID, supplierOrgID string, productIDs []string) error {
	if len(productIDs) == 0 || buyerOrgID == "" || supplierOrgID == "" || pickupBranchID == "" {
		return fmt.Errorf("missing recurring deps")
	}
	var list struct {
		Items []struct{ ID string `json:"id"` } `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/recurring?organization_id="+supplierOrgID+"&role=supplier", supplier.Token, nil, &list)
	if len(list.Items) > 0 {
		log.Printf("skip recurring — already %d", len(list.Items))
		return nil
	}
	start := time.Now().UTC().AddDate(0, 0, 7).Format("2006-01-02")
	var created struct{ ID string `json:"id"` }
	status, err := doJSON(c, http.MethodPost, base+"/v1/commerce/recurring", master.Token, map[string]any{
		"supplier_org_id":  supplierOrgID,
		"buyer_org_id":     buyerOrgID,
		"pickup_branch_id": pickupBranchID,
		"frequency":        "weekly",
		"start_date":       start,
		"horizon_days":     28,
		"items":            []map[string]any{{"product_id": productIDs[0], "qty": 2}},
	}, &created)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("create recurring status %d", status)
	}
	_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/recurring/"+created.ID+"/decide", supplier.Token, map[string]any{"action": "approve"}, nil)
	return nil
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

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func fatal(format string, args ...any) {
	log.Printf("error: "+format, args...)
	os.Exit(1)
}
