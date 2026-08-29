// Command seed loads demo accounts and sample data through the API gateway.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"strings"
	"time"

	_ "time/tzdata" // embed zoneinfo for Windows hosts without system tz data
)

const defaultPassword = "Password123!"

func main() {
	base := strings.TrimRight(envOr("GATEWAY_URL", "http://localhost:8090"), "/")
	if envOr("APP_ENV", "") == "production" && envOr("ALLOW_SEED", "false") != "true" {
		fatal("refusing seed in APP_ENV=production (set ALLOW_SEED=true only on intentional demo/staging hosts)")
	}
	password := envOr("SEED_PASSWORD", defaultPassword)
	client := &http.Client{Timeout: 30 * time.Second}

	log.Printf("seed: gateway=%s", base)
	if err := waitHealth(client, base); err != nil {
		fatal("gateway health: %v", err)
	}

	accounts := []accountSpec{
		{Email: "client1@demo.local", Name: "Клиент Один", Role: "client", City: "Красноярск", Phone: "+79001000001"},
		{Email: "client2@demo.local", Name: "Клиент Два", Role: "client", Phone: "+79001000002"},
		{Email: "client3@demo.local", Name: "Клиент Три", Role: "client", City: "Москва", Phone: "+79001000003"},
		{Email: "master1@demo.local", Name: "Мастер Анна", Role: "master"},
		{Email: "master2@demo.local", Name: "Мастер Иван", Role: "master"},
		{Email: "master3@demo.local", Name: "Мастер Ольга", Role: "master"},
		{Email: "master4@demo.local", Name: "Мастер Дмитрий", Role: "master"},
		{Email: "admin1@demo.local", Name: "Админ Салона", Role: "salon_admin"},
		{Email: "employee1@demo.local", Name: "Мастер Сотрудник", Role: "master", City: "Красноярск", Phone: "+79001110001"},
		{Email: "supplier1@demo.local", Name: "Поставщик Профи", Role: "supplier"},
		{Email: "supplier2@demo.local", Name: "Поставщик БьютиЛайн", Role: "supplier"},
		{Email: "rep1@demo.local", Name: "Представитель Елена", Role: "supplier_rep", City: "Красноярск"},
		{Email: "rep2@demo.local", Name: "Представитель Павел", Role: "supplier_rep", City: "Москва"},
		{Email: "chain1@demo.local", Name: "Сеть Владелец", Role: "master"},
		{Email: "mobile1@demo.local", Name: "Выездной Мастер", Role: "master", City: "Красноярск"},
		{Email: "expired1@demo.local", Name: "Мастер Trial Expired", Role: "master"},
		{Email: "premium1@demo.local", Name: "Мастер Premium", Role: "master"},
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
	var m4Profile string
	supplier1 := users["supplier1@demo.local"]
	supplier2 := users["supplier2@demo.local"]
	client1 := users["client1@demo.local"]

	m1Org, m1Branch, m1Profile, m1Service, err := seedMaster(client, base, master1, masterSeed{
		OrgName: "Салон Анны (demo)", BranchName: "Красноярск центр",
		City: "Красноярск", Address: "ул. Ленина, 50", Phone: "+79001112233", Timezone: "Asia/Krasnoyarsk",
		Display: "Анна Колористика", Bio: "Мастер-колорист в Красноярске. Демо-профиль для Salon-X.",
		Specs: []string{"колористика", "стрижки"}, Experience: 7, Education: "Академия колористики",
		WorkType:          "owner",
		ProfessionTypeIDs: []string{professionTypeColorist, professionTypeHairdresser},
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

	var m2Org, m2Branch string
	m2Org, m2Branch, _, _, err = seedMaster(client, base, master2, masterSeed{
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

	_, _, m4Profile, _, err = seedMaster(client, base, master4, masterSeed{
		OrgName: "Кабинет Дмитрия (demo)", BranchName: "Красноярск север",
		City: "Красноярск", Address: "ул. Мира, 12", Phone: "+79001234567", Timezone: "Asia/Krasnoyarsk",
		Display: "Дмитрий Бровист", Bio: "Независимый мастер бровей и ресниц в Красноярске.",
		Specs: []string{"брови", "ресницы"}, Experience: 6, Education: "Brow School",
		WorkType: "independent",
		Services: []serviceSpec{
			{Name: "Коррекция бровей", Category: "брови", Description: "Форма бровей под тип лица.", Duration: 40, Price: 180000},
			{Name: "Окрашивание (Phase4)", Category: "колористика", Description: "Демо Phase4: обязательная схема на Free.", Duration: 120, Price: 450000},
			{Name: "Окрашивание бровей", Category: "брови", Description: "Стойкое окрашивание с подбором оттенка.", Duration: 50, Price: 200000},
			{Name: "Ламинирование ресниц", Category: "ресницы", Description: "Ламинирование и питание ресниц.", Duration: 70, Price: 320000},
		},
	})
	if err != nil {
		fatal("master4: %v", err)
	}
	log.Printf("ok master4 city=Красноярск tz=Asia/Krasnoyarsk work_type=independent")

	premium1 := users["premium1@demo.local"]
	expired1 := users["expired1@demo.local"]
	p1Org, _, p1Profile, p1Service, err := seedMaster(client, base, premium1, masterSeed{
		OrgName: "Premium Studio (demo)", BranchName: "Красноярск центр",
		City: "Красноярск", Address: "пр. Мира, 88", Phone: "+79007776655", Timezone: "Asia/Krasnoyarsk",
		Display: "Premium Demo Master", Bio: "Paid Premium master for Phase4 acceptance.",
		Specs: []string{"колористика"}, Experience: 10, Education: "Premium Academy",
		WorkType: "independent",
		Services: []serviceSpec{
			{Name: "Окрашивание (Phase4 Premium)", Category: "колористика", Description: "Premium skip-scheme demo.", Duration: 120, Price: 550000},
		},
	})
	if err != nil {
		log.Printf("warn premium1 master: %v", err)
	} else {
		log.Printf("ok premium1 org=%s profile=%s service=%s", p1Org, p1Profile, p1Service)
	}
	_, _, e1Profile, e1Service, err := seedMaster(client, base, expired1, masterSeed{
		OrgName: "Expired Trial (demo)", BranchName: "Красноярск юг",
		City: "Красноярск", Address: "ул. Вавилова, 3", Phone: "+79006665544", Timezone: "Asia/Krasnoyarsk",
		Display: "Expired Trial Master", Bio: "Expired trial → Free for Phase4.",
		Specs: []string{"колористика"}, Experience: 4, Education: "Demo School",
		WorkType: "independent",
		Services: []serviceSpec{
			{Name: "Окрашивание (Phase4 Expired)", Category: "колористика", Description: "Expired trial must fill scheme.", Duration: 120, Price: 400000},
		},
	})
	if err != nil {
		log.Printf("warn expired1 master: %v", err)
	} else {
		log.Printf("ok expired1 profile=%s service=%s", e1Profile, e1Service)
	}

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

	if err := seedKnowledge(client, base, supplier1, "Поставщик Профи", sup1Org, products1); err != nil {
		log.Printf("warn knowledge: %v", err)
	} else {
		log.Printf("ok knowledge articles (supplier-authored)")
	}
	if err := seedKnowledgeSupplier2(client, base, supplier2, "Поставщик БьютиЛайн", sup2Org, products2); err != nil {
		log.Printf("warn knowledge supplier2: %v", err)
	} else {
		log.Printf("ok knowledge articles (supplier2)")
	}
	if err := seedKnowledgeFavorites(client, base, master1); err != nil {
		log.Printf("warn knowledge favorites: %v", err)
	} else {
		log.Printf("ok knowledge favorites for master1")
	}

	apptID, err := seedAppointments(client, base, client1, master1, m1Profile, func() string {
		if id, err := lookupMasterServiceByName(client, base, master1, "Окрашивание"); err == nil {
			return id
		}
		return m1Service
	}())
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

	if err := seedMaster2Inventory(client, base, master2, supplier1, m2Org, m2Branch, products1); err != nil {
		log.Printf("warn master2 inventory: %v", err)
	} else {
		log.Printf("ok master2 inventory")
	}

	if err := seedRecurring(client, base, master1, supplier1, m1Org, m1Branch, sup1Org, products1); err != nil {
		log.Printf("warn recurring: %v", err)
	} else {
		log.Printf("ok recurring supply")
	}

	admin1 := users["admin1@demo.local"]
	if err := seedAdminMembership(client, base, master1, admin1, m1Org); err != nil {
		log.Printf("warn admin membership: %v", err)
	} else {
		log.Printf("ok salon administrator membership")
	}

	employee1 := users["employee1@demo.local"]
	if employee1.ID != "" {
		if err := seedSalonEmployee(client, base, master1, employee1, client1, m1Org, m1Branch); err != nil {
			log.Printf("warn salon employee: %v", err)
		} else {
			log.Printf("ok salon employee of Anna")
		}
	}

	chain := users["chain1@demo.local"]
	if chain.ID != "" {
		if err := seedChainOwner(client, base, chain); err != nil {
			log.Printf("warn chain owner: %v", err)
		} else {
			log.Printf("ok chain owner")
		}
	}
	mobile := users["mobile1@demo.local"]
	if mobile.ID != "" {
		_, _, _, _, err = seedMaster(client, base, mobile, masterSeed{
			OrgName: "Выездной сервис (demo)", BranchName: "Красноярск выезд",
			City: "Красноярск", Address: "выезд к клиенту", Phone: "+79001230000", Timezone: "Asia/Krasnoyarsk",
			Display: "Мария Выезд", Bio: "Выездной мастер окрашивания.",
			Specs: []string{"колористика"}, Experience: 6, Education: "Academy",
			WorkType: "mobile_master",
			Services: []serviceSpec{
				{Name: "Окрашивание на дому", Category: "колористика", Description: "Выезд с материалами.", Duration: 150, Price: 650000},
			},
		})
		if err != nil {
			log.Printf("warn mobile master: %v", err)
		} else {
			log.Printf("ok mobile master")
		}
	}

	if err := seedSubscriptions(client, base, users); err != nil {
		log.Printf("warn subscriptions: %v", err)
	} else {
		log.Printf("ok subscription variants")
	}
	if err := seedHintPrefs(client, base, users); err != nil {
		log.Printf("warn hints: %v", err)
	}

	client2 := users["client2@demo.local"]
	client3 := users["client3@demo.local"]
	if err := seedNoShowScenario(client, base, client2, client3, master1, m1Profile, m1Service); err != nil {
		log.Printf("warn no-show scenario: %v", err)
	} else {
		log.Printf("ok no-show + blacklist")
	}

	if err := seedPlannerBlocks(client, base, master1); err != nil {
		log.Printf("warn planner blocks: %v", err)
	}

	if err := seedClientShopOrder(client, base, client1, products1, m1Branch); err != nil {
		log.Printf("warn client shop order: %v", err)
	} else {
		log.Printf("ok client marketplace order")
	}

	if err := seedClient2ShopHistory(client, base, client2, supplier1, master1, rep1, products1, products2, m1Branch); err != nil {
		log.Printf("warn client2 shop history: %v", err)
	} else {
		log.Printf("ok client2 shop order history")
	}

	if err := seedPhase2History(client, base, master1, supplier1, client1, m1Org, m1Branch, products1, rep1, rep2); err != nil {
		log.Printf("warn phase2 history: %v", err)
	} else {
		log.Printf("ok phase2 analytics history")
	}

	if err := seedPhase4Appointments(client, base, users, master1, m1Profile, m1Service, master4, m4Profile, premium1, p1Profile, p1Service, expired1, e1Profile, e1Service); err != nil {
		log.Printf("warn phase4 appointments: %v", err)
	} else {
		log.Printf("ok phase4 subscription + scheme appointments")
	}

	if err := seedRepRoute(client, base, supplier1, sup1Org, m1Branch, users["rep1@demo.local"]); err != nil {
		log.Printf("warn rep route: %v", err)
	} else {
		log.Printf("ok representative route")
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
	log.Printf("master4@demo.local city=Красноярск Asia/Krasnoyarsk      work_type=independent (FREE)")
	log.Printf("chain1@demo.local  work_type=chain_owner (2 branches)")
	log.Printf("mobile1@demo.local work_type=mobile_master")
	log.Printf("admin1@demo.local  salon_admin of Anna salon")
	log.Printf("employee1@demo.local employee of Anna salon (no own org)")
	log.Printf("expired1@demo.local expired trial → FREE")
	log.Printf("premium1@demo.local paid Premium (hints OFF)")
	log.Printf("client2@demo.local one no-show; client3@demo.local blacklisted at master1")
	log.Printf("supplier1@demo.local org=%s", truncate(sup1Org, 36))
	log.Printf("supplier2@demo.local org=%s", truncate(sup2Org, 36))
}

// --- types ---

type accountSpec struct {
	Email string
	Name  string
	Role  string
	City  string // optional; applied via PATCH /v1/auth/me (register has no city field)
	Phone string
}

type authUser struct {
	Token string
	ID    string
	Email string
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
	ProfessionTypeIDs                                   []string
	Experience                                          int
	Services                                            []serviceSpec
	PhotoMediaID                                        string
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
		{Brand: "Estel", Name: "Race Test Single Unit", SKU: "S1-RACE-001", Unit: "pcs", Volume: "30ml", Category: "уход", Description: "E2E stock race product (qty=1)", Price: 100000, Published: true, ForSale: true, DeliveryDays: 1},
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
		return authUser{Token: loginResp.AccessToken, ID: loginResp.User.ID, Email: a.Email, Roles: loginResp.User.Roles}, nil
	}

	reg := map[string]any{
		"email": a.Email, "password": password, "display_name": a.Name,
	}
	if a.Phone != "" {
		reg["phone"] = a.Phone
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
	return authUser{Token: loginResp.AccessToken, ID: loginResp.User.ID, Email: a.Email, Roles: loginResp.User.Roles}, nil
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
	cfg = withOptionalPortrait(c, base, user, cfg)
	orgID, branchID, err = ensureOrg(c, base, user, "salon", cfg.OrgName, cfg.BranchName, cfg.City, cfg.Address, cfg.Timezone)
	if err != nil {
		return "", "", "", "", err
	}

	// Branch readiness requires phone/city/address/timezone; pickup_enabled for supplier-order destinations.
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/branches/"+branchID, user.Token, map[string]any{
		"phone": cfg.Phone, "city": cfg.City, "address_line": cfg.Address, "timezone": cfg.Timezone,
		"name": cfg.BranchName, "pickup_enabled": true,
		"latitude": cityLat(cfg.City), "longitude": cityLng(cfg.City),
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
		"latitude": cityLat(cfg.City), "longitude": cityLng(cfg.City),
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
		"organization_id":     orgID,
		"branch_id":           branchID,
		"display_name":        cfg.Display,
		"bio":                 cfg.Bio,
		"specializations":     cfg.Specs,
		"city":                cfg.City,
		"experience_years":    cfg.Experience,
		"education":           cfg.Education,
		"published":           published,
		"profession_type_ids": professionTypeIDsForSeed(cfg),
	}
	if cfg.WorkType != "" {
		body["work_type"] = cfg.WorkType
	}
	if cfg.PhotoMediaID != "" {
		body["photo_media_id"] = cfg.PhotoMediaID
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

const (
	professionTypeColorist       = "11111111-1111-4111-8111-111111111001"
	professionTypeHairdresser    = "11111111-1111-4111-8111-111111111002"
	professionTypeBarber         = "11111111-1111-4111-8111-111111111003"
	professionTypeNailMaster     = "11111111-1111-4111-8111-111111111004"
	professionTypePedicureMaster = "11111111-1111-4111-8111-111111111005"
)

func professionTypeIDsForSeed(cfg masterSeed) []string {
	if len(cfg.ProfessionTypeIDs) > 0 {
		return cfg.ProfessionTypeIDs
	}
	seen := map[string]struct{}{}
	var out []string
	add := func(id string) {
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, spec := range cfg.Specs {
		switch strings.ToLower(strings.TrimSpace(spec)) {
		case "колористика", "колорист", "окрашивание":
			add(professionTypeColorist)
		case "стрижки", "стрижка", "парикмахер", "укладки", "укладка", "уход":
			add(professionTypeHairdresser)
		case "барбер", "борода":
			add(professionTypeBarber)
		case "маникюр", "ногти":
			add(professionTypeNailMaster)
		case "педикюр":
			add(professionTypePedicureMaster)
		}
	}
	if len(out) == 0 {
		// Demo-only fallback for unmapped tags (брови/ресницы). Not used for new registrations.
		add(professionTypeHairdresser)
	}
	return out
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
			ID           string  `json:"id"`
			Name         string  `json:"name"`
			PhotoMediaID *string `json:"photo_media_id"`
		} `json:"services"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/me/master", user.Token, nil, &me)
	byName := map[string]string{}
	hasPhoto := map[string]bool{}
	for _, s := range me.Services {
		key := strings.ToLower(s.Name)
		byName[key] = s.ID
		hasPhoto[key] = s.PhotoMediaID != nil && strings.TrimSpace(*s.PhotoMediaID) != ""
	}

	ids := make([]string, 0, len(specs))
	for _, sp := range specs {
		id, ok := byName[strings.ToLower(sp.Name)]
		if !ok {
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
			id = created.ID
		}
		if id == "" {
			continue
		}
		ids = append(ids, id)
		attachSeedServicePhoto(c, base, user, id, sp.Name, hasPhoto[strings.ToLower(sp.Name)])
	}
	return ids, nil
}

// seedFixedWindowWorkshop creates Anna's author workshop + one Krasnoyarsk occurrence (~next week 14:00–18:00).
func seedFixedWindowWorkshop(c *http.Client, base string, user authUser, orgID, branchID string) error {
	const workshopName = "Авторский мастер-класс по окрашиванию"
	ids, err := ensureServices(c, base, user, orgID, []serviceSpec{{
		Name: workshopName, Category: "обучение",
		Description: "Групповой мастер-класс по авторским техникам окрашивания. Запись на фиксированное окно.",
		Duration:    240, Price: 850000, BookingMode: "fixed_window",
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
		"branch_id": branchID,
		"starts_at": startsLocal.UTC().Format(time.RFC3339),
		"ends_at":   endsLocal.UTC().Format(time.RFC3339),
		"timezone":  "Asia/Krasnoyarsk",
		"capacity":  3,
		"title":     workshopName,
		"note":      "Демо fixed_window occurrence capacity=3 (Salon-X)",
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
		log.Printf("skip bulk product create for org=%s — already %d published (need %d); upserting missing SKUs", orgID, publishedCount, cfg.MinPublished)
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
		qty := 50.0
		if strings.Contains(w.SKU, "RACE-") {
			qty = 1
		}
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/stock/movements", user.Token, map[string]any{
			"location_id": locID, "product_id": id, "kind": "receipt", "qty": qty, "reason": "seed stock",
		}, nil)
		if photoID := uploadSeedAssetIfExists(c, base, user.Token, "product",
			"products/"+w.SKU+".jpg",
			"products/"+w.SKU+".jpeg",
			"products/"+w.SKU+".png",
			"products/"+w.SKU+".webp",
		); photoID != "" {
			_, _ = doJSON(c, http.MethodPut, base+"/v1/commerce/products/"+id, user.Token, map[string]any{
				"photo_media_id": photoID,
			}, nil)
		}
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
	createRep := func(user authUser, city, territory, name, email string, salons []string) (string, error) {
		var created struct {
			ID string `json:"id"`
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/representatives", supplier.Token, map[string]any{
			"user_id": user.ID, "city": city, "territory": territory,
			"display_name": name, "email": email, "salon_branch_ids": salons,
		}, &created)
		if err != nil {
			return "", err
		}
		if status >= 300 {
			return "", fmt.Errorf("create rep %s status %d", email, status)
		}
		return created.ID, nil
	}
	rep1ID, err := createRep(rep1, "Красноярск", "Красноярск", "Представитель Елена", "rep1@demo.local", []string{salonBranchID})
	if err != nil {
		return err
	}
	rep2ID, err := createRep(rep2, "Москва", "Москва", "Представитель Павел", "rep2@demo.local", nil)
	if err != nil {
		log.Printf("warn create rep2: %v", err)
	}
	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 11, 30, 0, 0, time.UTC)
	createTask := func(repID, title, kind, priority string, due time.Time, desc, expected string) {
		if repID == "" {
			return
		}
		_, _ = doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/tasks", supplier.Token, map[string]any{
			"representative_id": repID,
			"title":             title,
			"kind":              kind,
			"description":       desc,
			"expected_result":   expected,
			"branch_id":         salonBranchID,
			"priority":          priority,
			"due_at":            due.Format(time.RFC3339),
		}, nil)
		cat := "task"
		switch kind {
		case "salon_visit", "commercial_visit":
			cat = "salon_visit"
		case "delivery_support":
			cat = "delivery"
		}
		token := rep1.Token
		if repID == rep2ID {
			token = rep2.Token
		}
		_, _ = doJSON(c, http.MethodPost, base+"/v1/planner/blocks", token, map[string]any{
			"title": title, "category": cat,
			"starts_at": due.Format(time.RFC3339), "ends_at": due.Add(45 * time.Minute).Format(time.RFC3339),
			"timezone": "Asia/Krasnoyarsk",
		}, nil)
	}
	var listed struct {
		Items []struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/organizations/"+orgID+"/representatives", supplier.Token, nil, &listed)
	for _, it := range listed.Items {
		switch strings.ToLower(it.Email) {
		case "rep1@demo.local":
			rep1ID = it.ID
		case "rep2@demo.local":
			rep2ID = it.ID
		}
	}
	var existingTasks struct {
		Items []struct {
			Title            string `json:"title"`
			RepresentativeID string `json:"representative_id"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/organizations/"+orgID+"/tasks", supplier.Token, nil, &existingTasks)
	hasTask := func(repID, title string) bool {
		for _, t := range existingTasks.Items {
			if t.RepresentativeID == repID && t.Title == title {
				return true
			}
		}
		return false
	}
	ensureTask := func(repID, title, kind, priority string, due time.Time, desc, expected string) {
		if hasTask(repID, title) {
			return
		}
		createTask(repID, title, kind, priority, due, desc, expected)
	}
	ensureTask(rep1ID, "Визит в салон Анны", "salon_visit", "high", today, "Показать новинки L'Oreal и снять заказ.", "Заявка на пополнение")
	ensureTask(rep1ID, "Сопровождение доставки", "delivery_support", "normal", today.Add(3*time.Hour), "Передать заказ и принять оплату.", "")
	if rep2ID != "" {
		ensureTask(rep2ID, "Просроченный коммерческий визит", "commercial_visit", "urgent", today.Add(-48*time.Hour), "Не состоялся вчера — закрыть или перенести.", "Договорённость о заказе")
		ensureTask(rep2ID, "Сбор оплаты", "payment_collection", "high", today.Add(5*time.Hour), "Инкассация по неоплаченным поставкам.", "")
	}
	return nil
}

func seedPhase2History(c *http.Client, base string, master, supplier, clientUser authUser, buyerOrgID, destBranchID string, productIDs []string, rep1, rep2 authUser) error {
	if len(productIDs) < 3 || buyerOrgID == "" {
		return fmt.Errorf("missing phase2 deps")
	}
	var mine struct {
		Items []struct {
			Organization struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			} `json:"organization"`
		} `json:"items"`
	}
	_, err := doJSON(c, http.MethodGet, base+"/v1/organizations/mine", supplier.Token, nil, &mine)
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
	locID, err := ensureLocation(c, base, master, buyerOrgID, "Основной склад", "salon")
	if err != nil {
		return err
	}
	var existing struct {
		Items []struct {
			Comment string `json:"comment"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/supplier-orders?organization_id="+buyerOrgID, master.Token, nil, &existing)
	haveHistory := false
	for _, o := range existing.Items {
		if strings.Contains(o.Comment, "[seed-history]") {
			haveHistory = true
			break
		}
	}
	createPaid := func(comment string, p0, p1 int, qty0, qty1 float64) (string, error) {
		var created struct {
			ID string `json:"id"`
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders", master.Token, map[string]any{
			"buyer_org_id": buyerOrgID, "supplier_org_id": supplierOrgID, "location_id": locID,
			"destination_branch_id": destBranchID, "payment_method": "bank_transfer", "comment": comment,
			"items": []map[string]any{
				{"product_id": productIDs[p0%len(productIDs)], "qty": qty0},
				{"product_id": productIDs[p1%len(productIDs)], "qty": qty1},
			},
		}, &created)
		if err != nil || status >= 300 {
			return "", fmt.Errorf("create history order status %d %v", status, err)
		}
		est := time.Now().UTC().AddDate(0, 0, 2)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/transition", supplier.Token, map[string]any{"status": "confirmed"}, nil)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/transition", supplier.Token, map[string]any{"status": "picking", "estimated_delivery_at": est}, nil)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/transition", supplier.Token, map[string]any{"status": "ready_for_dispatch"}, nil)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/mark-paid", supplier.Token, map[string]any{}, nil)
		return created.ID, nil
	}
	if !haveHistory {
		for i := 0; i < 10; i++ {
			daysAgo := 7 + i*6
			if daysAgo > 80 {
				daysAgo = 80 - i
			}
			id, err := createPaid(fmt.Sprintf("[seed-history] заказ %d", i+1), i%3, (i+1)%3, float64(1+i%3), float64(1+i%2))
			if err != nil {
				log.Printf("warn history order %d: %v", i, err)
				continue
			}
			at := time.Now().UTC().AddDate(0, 0, -daysAgo).Format(time.RFC3339)
			st, _ := doJSON(c, http.MethodPost, base+"/v1/commerce/dev/backdate", supplier.Token, map[string]any{
				"kind": "supplier", "order_id": id, "created_at": at,
			}, nil)
			if st >= 300 {
				log.Printf("warn backdate supplier order %s status=%d", id, st)
			}
		}
		// one unpaid current order for outstanding chart
		_, _ = createPaid("[seed-history-unpaid] ожидает оплату", 0, 3, 2, 1)
		// last createPaid marks paid — make a raw unpaid instead
		var unpaid struct {
			ID string `json:"id"`
		}
		st, _ := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders", master.Token, map[string]any{
			"buyer_org_id": buyerOrgID, "supplier_org_id": supplierOrgID, "location_id": locID,
			"destination_branch_id": destBranchID, "payment_method": "invoice", "comment": "[seed-history] unpaid",
			"items": []map[string]any{{"product_id": productIDs[0], "qty": 3}},
		}, &unpaid)
		if st < 300 && unpaid.ID != "" {
			_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+unpaid.ID+"/transition", supplier.Token, map[string]any{"status": "confirmed"}, nil)
		}
	}

	var shopExisting struct {
		Items []struct {
			ID              string `json:"id"`
			DeliveryComment string `json:"delivery_comment"`
			Status          string `json:"status"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/shop/supplier/orders?organization_id="+supplierOrgID, supplier.Token, nil, &shopExisting)
	haveRepFlow := false
	for _, o := range shopExisting.Items {
		if strings.Contains(o.DeliveryComment, "[seed-rep]") {
			haveRepFlow = true
			break
		}
	}
	if haveRepFlow {
		return nil
	}

	pushShop := func(comment, address string, productIdx int, qty float64) (string, error) {
		st, err := doJSON(c, http.MethodPut, base+"/v1/commerce/shop/cart/items", clientUser.Token, map[string]any{
			"product_id": productIDs[productIdx%len(productIDs)], "qty": qty,
		}, nil)
		if err != nil || st >= 300 {
			return "", fmt.Errorf("cart %d %v", st, err)
		}
		ids, err := checkoutShopOrder(c, base, clientUser.Token, map[string]any{
			"delivery_address": address, "delivery_comment": comment,
			"payment_method": "cash_on_delivery", "pickup_branch_id": destBranchID,
		})
		if err != nil {
			return "", err
		}
		if len(ids) == 0 {
			return "", fmt.Errorf("checkout returned no orders")
		}
		return ids[0], nil
	}
	advance := func(id, status, repID string) {
		body := map[string]any{"status": status}
		if repID != "" {
			body["rep_user_id"] = repID
		}
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/shop/supplier/orders/"+id+"/transition", supplier.Token, body, nil)
	}
	complete := func(id string, amount int64, paid bool, token string) {
		var order struct {
			Items []struct {
				ProductID string  `json:"product_id"`
				Qty       float64 `json:"qty"`
			} `json:"items"`
		}
		_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/shop/orders/"+id, clientUser.Token, nil, &order)
		items := make([]map[string]any, 0, len(order.Items))
		for _, it := range order.Items {
			items = append(items, map[string]any{"product_id": it.ProductID, "qty_delivered": it.Qty})
		}
		if len(items) == 0 {
			items = []map[string]any{{"product_id": productIDs[0], "qty_delivered": 1}}
		}
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/rep/deliveries/"+id+"/complete", token, map[string]any{
			"items": items, "note": "seed", "amount_collected_minor": amount, "payment_received": paid,
		}, nil)
	}

	addresses := []string{
		"Салон Анны, ул. Ленина, 50",
		"Салон на Мира, 10",
		"Студия Ольги, пр. Мира, 88",
	}
	// Rep1: several deliveries today + completed history
	for i := 0; i < 3; i++ {
		id, err := pushShop("[seed-rep] today "+fmt.Sprint(i+1), addresses[i%len(addresses)], i%3, float64(1+i))
		if err != nil {
			log.Printf("warn shop today %d: %v", i, err)
			continue
		}
		advance(id, "confirmed", "")
		advance(id, "picking", "")
		advance(id, "in_delivery", rep1.ID)
	}
	for i := 0; i < 6; i++ {
		id, err := pushShop("[seed-rep] hist "+fmt.Sprint(i+1), addresses[i%len(addresses)], i%3, 1)
		if err != nil {
			log.Printf("warn shop hist %d: %v", i, err)
			continue
		}
		advance(id, "confirmed", "")
		advance(id, "picking", "")
		advance(id, "in_delivery", rep1.ID)
		complete(id, 89000, true, rep1.Token)
		at := time.Now().UTC().AddDate(0, 0, -(4 + i*5)).Format(time.RFC3339)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/dev/backdate", supplier.Token, map[string]any{
			"kind": "client", "order_id": id, "created_at": at,
		}, nil)
	}
	if rep2.ID != "" {
		id, err := pushShop("[seed-rep] pavel overdue", "Салон Москвы, Тверская, 7", 2, 2)
		if err == nil {
			advance(id, "confirmed", "")
			advance(id, "picking", "")
			advance(id, "in_delivery", rep2.ID)
		}
		for i := 0; i < 3; i++ {
			id, err := pushShop("[seed-rep] pavel hist "+fmt.Sprint(i+1), "Салон Москвы, Арбат, 12", i, 1)
			if err != nil {
				continue
			}
			advance(id, "confirmed", "")
			advance(id, "picking", "")
			advance(id, "in_delivery", rep2.ID)
			complete(id, 42000, i > 0, rep2.Token)
			at := time.Now().UTC().AddDate(0, 0, -(10 + i*8)).Format(time.RFC3339)
			_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/dev/backdate", supplier.Token, map[string]any{
				"kind": "client", "order_id": id, "created_at": at,
			}, nil)
		}
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

func seedKnowledge(c *http.Client, base string, user authUser, authorName, orgID string, productIDs []string) error {
	media, err := seedKnowledgeMedia(c, base, user)
	if err != nil {
		log.Printf("warn kb media: %v", err)
	}
	cats := listProductCategoryIDs(c, base, user)
	paint := nonempty(cats["краска"])
	care := nonempty(cats["уход"])
	ox := nonempty(cats["окислитель"])
	style := nonempty(cats["стайлинг"])

	p := func(i int) []string { return pickIndex(productIDs, i) }
	rich := func(opts kbDocOpts) string { return knowledgeDocJSON(media, opts) }

	articles := []kbArt{
		{Title: "Основы колористики: тон и фон осветления", Category: "Колористика", Brand: "L'Oreal",
			Content:   rich(kbDocOpts{H: "Тон и фон осветления", Body: "Практический гид по уровням тона: как не пережечь фон и сохранить плотность цвета Majirel.", List: []string{"Определите исходный уровень", "Сверьте фон осветления с картой", "Подберите оксид 3/6/9%"}, Tip: "Держите прядь-контроль каждые 10 минут на пористых волосах.", Image: true, Video: true}),
			WithCover: true, ProductIDs: p(0), CategoryIDs: paint},
		{Title: "Протокол уходовых процедур", Category: "Процедуры", Brand: "Olaplex",
			Content:   rich(kbDocOpts{H: "Протокол ухода", Body: "Диагностика → No.0/No.3 → выдержка → финиш. Не смешивайте с прямым пигментом в одной чаше.", List: []string{"Пористость и эластичность", "Нанесение от длины к корню", "Домашний уход на 2 недели"}, Warn: "Не превышайте время выдержки на осветлённых волосах.", Image: true}),
			WithCover: true, ProductIDs: firstN(productIDs, 2), CategoryIDs: care},
		{Title: "Как выбирать окислитель", Category: "Продукция", Brand: "Wella",
			Content:   rich(kbDocOpts{H: "Окислители 3% / 6% / 9%", Body: "Совместимость с крем-красками Koleston и контроль фона осветления.", List: []string{"3% — тон в тон и затемнение", "6% — покрытие седины", "9% — подъём на 2–3 уровня"}, Tip: "На тонких волосах лучше 6% дольше, чем 9% быстрее."}),
			WithCover: true, CategoryIDs: ox},
		{Title: "Работа с блондом без пересушивания", Category: "Колористика", Brand: "Estel",
			Content:   rich(kbDocOpts{H: "Блонд без ломкости", Body: "Поэтапное осветление Essex и защита структуры протеиновым уходом.", Image: true}),
			WithCover: true, ProductIDs: p(7)},
		{Title: "Домашний уход после салона", Category: "Уход", Brand: "Olaplex",
			Content:   rich(kbDocOpts{H: "Рекомендации клиенту", Body: "Что рекомендовать после окрашивания: No.3 два раза в неделю, без сульфатов первые 14 дней."}),
			WithCover: true, ProductIDs: p(5), CategoryIDs: care},
		{Title: "Стайлинг: фиксация без жёсткости", Category: "Стайлинг", Brand: "Wella",
			Content:    rich(kbDocOpts{H: "Фиксация", Body: "EIMI Super Set: нанесите на сухие волосы с расстояния 20 см, не лакируйте у корня."}),
			ProductIDs: p(11), CategoryIDs: style},
		{Title: "Rich-док: формула окрашивания", Category: "Колористика", Brand: "L'Oreal",
			Content:   rich(kbDocOpts{H: "Формула окрашивания", Body: "Пример схемы Majirel + оксид 6%: 1:1.5, выдержка 35 минут, эмульгация 2 минуты.", Image: true, Video: true, Tip: "Сначала проработайте седину у висков."}),
			WithCover: true, ProductIDs: firstN(productIDs, 2), CategoryIDs: paint},
		{Title: "Кислотный уход vs протеиновый", Category: "Уход", Brand: "Olaplex",
			Content:   rich(kbDocOpts{H: "Кислота и протеин", Body: "Кислотный уход закрывает кутикулу после щёлочи. Протеин — если волосы тянутся и рвутся."}),
			WithCover: true, CategoryIDs: care},
		{Title: "Коррекция цвета после домашнего окрашивания", Category: "Колористика", Brand: "Wella",
			Content:   rich(kbDocOpts{H: "Коррекция", Body: "Безопасный путь: диагностика, снятие, тонирование Koleston без агрессивного осветления в один визит.", Warn: "Не делайте двойной блонд в день коррекции."}),
			WithCover: true, ProductIDs: p(3)},
		{Title: "Санитарные нормы рабочего места", Category: "Салон", Brand: "Salon-X",
			Content: rich(kbDocOpts{H: "Санитария", Body: "Чек-лист: барьеры, дезинфекция чаш, одноразовые воротнички, проветривание после осветления."})},
		{Title: "Подбор окислителя для седины", Category: "Продукция", Brand: "Estel",
			Content:   rich(kbDocOpts{H: "Седины", Body: "Покрытие седины Essex: 6% на плотной седине, предварительное заполнение на стеклевидных волосах."}),
			WithCover: true, ProductIDs: p(7), CategoryIDs: paint},
		{Title: "Летний уход: UV-защита волос", Category: "Уход", Brand: "L'Oreal",
			Content:   rich(kbDocOpts{H: "UV-защита", Body: "Летний протокол Absolut Repair: несмываемый крем перед пляжем, шампунь без сульфатов."}),
			WithCover: true, ProductIDs: p(2), CategoryIDs: care},
		{Title: "Инструкция: Majirel — пропорции и выдержка", Category: "Колористика", Brand: "L'Oreal",
			Content:   rich(kbDocOpts{H: "Majirel по шагам", Body: "Смешайте крем-краску Majirel с оксидантом 1:1.5. Нанесите на сухие волосы, выдержка 35 минут.", List: []string{"Чаша и кисть только для краски", "Эмульгация тёплой водой", "Закройте кутикулу кислым уходом"}, Image: true, Video: true, Tip: "На корнях держите на 5 минут меньше, чем на длине."}),
			WithCover: true, ProductIDs: p(0), CategoryIDs: paint},
		{Title: "Troubleshooting: пятна на коже после окрашивания", Category: "Колористика", Brand: "Estel",
			Content:   rich(kbDocOpts{H: "Снятие пятен", Body: "Не трите кожу спиртом. Используйте специализированный ремувер и масло по контуру роста волос до нанесения.", Warn: "Агрессивные растворители сушат кожу и дают раздражение."}),
			WithCover: true},
		{Title: "Техника балаяжа на Koleston Perfect", Category: "Колористика", Brand: "Wella",
			Content:   rich(kbDocOpts{H: "Балаяж", Body: "Свободная техника на Koleston: работайте от лица, не перегружайте оксидом 9% у корня.", Image: true}),
			WithCover: true, ProductIDs: p(3), CategoryIDs: paint},
		{Title: "Работа с линейкой Olaplex в салоне", Category: "Уход", Brand: "Olaplex",
			Content:   rich(kbDocOpts{H: "Салонный Olaplex", Body: "No.1/No.2 в услуге окрашивания: добавляйте в смесь по протоколу бренда, не заменяйте оксид.", List: []string{"Совместимость с Majirel", "Выдержка No.2 10–20 мин", "Дома — No.3 и No.6"}}),
			WithCover: true, ProductIDs: []string{}, CategoryIDs: care},
	}
	if len(productIDs) > 5 {
		articles[len(articles)-1].ProductIDs = []string{productIDs[5]}
		if len(productIDs) > 6 {
			articles[len(articles)-1].ProductIDs = append(articles[len(articles)-1].ProductIDs, productIDs[6])
		}
	}
	draft := kbArt{Title: "Черновик: внутренняя памятка колориста", Category: "Колористика", Brand: "L'Oreal",
		Content: rich(kbDocOpts{H: "Внутренняя памятка", Body: "Не публиковать: рабочие формулы салона-партнёра."}), Draft: true}
	articles = append(articles, draft)
	return postKnowledgeArticles(c, base, user, authorName, orgID, media.CoverID, articles)
}

func seedKnowledgeSupplier2(c *http.Client, base string, user authUser, authorName, orgID string, productIDs []string) error {
	media, err := seedKnowledgeMedia(c, base, user)
	if err != nil {
		log.Printf("warn kb media s2: %v", err)
	}
	cats := listProductCategoryIDs(c, base, user)
	paint := nonempty(cats["краска"])
	mask := nonempty(cats["маска"])
	rich := func(opts kbDocOpts) string { return knowledgeDocJSON(media, opts) }
	articles := []kbArt{
		{Title: "Dia Richesse: тонирование без осветления", Category: "Колористика", Brand: "L'Oreal",
			Content:   rich(kbDocOpts{H: "Тонирование", Body: "Dia Richesse даёт тон без подъёма. Идеально для коррекции блонда и блеска натуральных волос.", Tip: "Не используйте как перманент на седине выше 50%.", Image: true}),
			WithCover: true, ProductIDs: pickIndex(productIDs, 0), CategoryIDs: paint},
		{Title: "Fusion-маска: интенсивное восстановление", Category: "Уход", Brand: "Wella",
			Content:   rich(kbDocOpts{H: "Протокол Fusion", Body: "Нанесите маску Fusion на вымытые полотенцем волосы на 5 минут. Не добавляйте тепло на очень повреждённых волосах.", Video: false}),
			WithCover: true, ProductIDs: pickIndex(productIDs, 1), CategoryIDs: mask},
		{Title: "Otium Aqua: увлажнение перед укладкой", Category: "Уход", Brand: "Estel",
			Content:   rich(kbDocOpts{H: "Увлажнение", Body: "Шампунь Otium Aqua — база перед термоукладкой. Не сочетайте в один день с сильным протеином."}),
			WithCover: true, ProductIDs: pickIndex(productIDs, 2)},
	}
	return postKnowledgeArticles(c, base, user, authorName, orgID, media.CoverID, articles)
}

type kbMedia struct{ CoverID, InlineID, VideoID, Base string }

type kbDocOpts struct {
	H, Body, Tip, Warn string
	List               []string
	Image, Video       bool
}

type kbArt struct {
	Title, Category, Brand, Content string
	ProductIDs, CategoryIDs         []string
	WithCover, Draft                bool
}

func seedKnowledgeMedia(c *http.Client, base string, user authUser) (kbMedia, error) {
	m := kbMedia{Base: base}
	m.CoverID = uploadSeedAssetIfExists(c, base, user.Token, "article",
		"articles/cover.jpg", "articles/cover.jpeg", "articles/cover.png", "articles/cover.webp")
	m.InlineID = uploadSeedAssetIfExists(c, base, user.Token, "article",
		"articles/inline.jpg", "articles/inline.jpeg", "articles/inline.png", "articles/inline.webp")
	m.VideoID = uploadSeedAssetIfExists(c, base, user.Token, "video",
		"articles/demo.webm", "articles/demo.mp4")
	return m, nil
}

func knowledgeDocJSON(media kbMedia, o kbDocOpts) string {
	apiMedia := func(id string) string {
		if id == "" {
			return ""
		}
		return media.Base + "/v1/media/" + id + "/content"
	}
	nodes := []map[string]any{
		kbHeading(2, o.H),
		kbPara(o.Body),
	}
	if len(o.List) > 0 {
		nodes = append(nodes, kbList(o.List...))
	}
	if o.Tip != "" {
		nodes = append(nodes, kbCallout("tip", o.Tip))
	}
	if o.Warn != "" {
		nodes = append(nodes, kbCallout("warning", o.Warn))
	}
	nodes = append(nodes, map[string]any{"type": "horizontalRule"})
	if o.Image && media.InlineID != "" {
		nodes = append(nodes, map[string]any{"type": "image", "attrs": map[string]any{"src": apiMedia(media.InlineID), "alt": "Иллюстрация протокола"}})
	}
	if o.Video && media.VideoID != "" {
		nodes = append(nodes, map[string]any{"type": "video", "attrs": map[string]any{"src": apiMedia(media.VideoID), "title": "Демо-ролик техники"}})
	}
	nodes = append(nodes, kbPara("Salon-X · материал поставщика"))
	b, _ := json.Marshal(map[string]any{"type": "doc", "content": nodes})
	return string(b)
}

func kbHeading(level int, text string) map[string]any {
	return map[string]any{"type": "heading", "attrs": map[string]any{"level": level}, "content": []map[string]any{{"type": "text", "text": text}}}
}
func kbPara(text string) map[string]any {
	return map[string]any{"type": "paragraph", "content": []map[string]any{{"type": "text", "text": text}}}
}
func kbList(items ...string) map[string]any {
	lis := make([]map[string]any, 0, len(items))
	for _, it := range items {
		lis = append(lis, map[string]any{"type": "listItem", "content": []map[string]any{kbPara(it)}})
	}
	return map[string]any{"type": "bulletList", "content": lis}
}
func kbCallout(kind, text string) map[string]any {
	return map[string]any{"type": "callout", "attrs": map[string]any{"kind": kind}, "content": []map[string]any{kbPara(text)}}
}

func postKnowledgeArticles(c *http.Client, base string, user authUser, authorName, orgID, coverID string, articles []kbArt) error {
	var list struct {
		Items []struct {
			Category string `json:"category"`
			Title    string `json:"title"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/knowledge?limit=100", user.Token, nil, &list)
	have := map[string]bool{}
	for _, it := range list.Items {
		have[strings.ToLower(it.Category+"|"+it.Title)] = true
	}
	mine, _ := doJSON(c, http.MethodGet, base+"/v1/me/knowledge?limit=100", user.Token, nil, &list)
	if mine < 300 {
		for _, it := range list.Items {
			have[strings.ToLower(it.Category+"|"+it.Title)] = true
		}
	}
	for _, a := range articles {
		key := strings.ToLower(a.Category + "|" + a.Title)
		if have[key] {
			log.Printf("skip knowledge %q", a.Title)
			continue
		}
		pub := !a.Draft
		payload := map[string]any{
			"title": a.Title, "category": a.Category, "content": a.Content, "brand": a.Brand,
			"author_name": authorName, "organization_id": orgID, "published": pub,
			"content_format": "doc_json",
		}
		if a.WithCover && coverID != "" {
			payload["cover_media_id"] = coverID
		}
		if len(a.ProductIDs) > 0 {
			payload["product_ids"] = a.ProductIDs
		}
		if len(a.CategoryIDs) > 0 {
			payload["category_ids"] = a.CategoryIDs
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

func seedKnowledgeFavorites(c *http.Client, base string, master authUser) error {
	var list struct {
		Items []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"items"`
	}
	_, err := doJSON(c, http.MethodGet, base+"/v1/knowledge?limit=100", master.Token, nil, &list)
	if err != nil {
		return err
	}
	want := []string{"инструкция: majirel", "основы колористики", "протокол уходовых"}
	n := 0
	for _, it := range list.Items {
		low := strings.ToLower(it.Title)
		for _, w := range want {
			if strings.Contains(low, w) {
				st, err := doJSON(c, http.MethodPost, base+"/v1/knowledge/"+it.ID+"/favorite", master.Token, map[string]any{}, nil)
				if err != nil {
					return err
				}
				if st < 300 {
					n++
				}
			}
		}
	}
	if n == 0 && len(list.Items) > 0 {
		_, _ = doJSON(c, http.MethodPost, base+"/v1/knowledge/"+list.Items[0].ID+"/favorite", master.Token, map[string]any{}, nil)
		if len(list.Items) > 1 {
			_, _ = doJSON(c, http.MethodPost, base+"/v1/knowledge/"+list.Items[1].ID+"/favorite", master.Token, map[string]any{}, nil)
		}
	}
	return nil
}

func nonempty(id string) []string {
	if id == "" {
		return nil
	}
	return []string{id}
}

func pickIndex(ids []string, i int) []string {
	if i < 0 || i >= len(ids) {
		return nil
	}
	return []string{ids[i]}
}

func firstN(ids []string, n int) []string {
	if len(ids) == 0 {
		return nil
	}
	if len(ids) < n {
		return ids
	}
	return ids[:n]
}

func uploadSeedBytes(c *http.Client, base, token, purpose, filename, contentType string, data []byte) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	h.Set("Content-Type", contentType)
	part, err := w.CreatePart(h)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	_ = w.WriteField("purpose", purpose)
	if err := w.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, base+"/v1/media", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("media upload %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.ID == "" {
		return "", fmt.Errorf("media upload parse: %s", truncate(string(body), 200))
	}
	return out.ID, nil
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

	// Complete flow so a visit appears on the client card (scheme required on Free; trial Premium may skip).
	if appt.Status != "completed" {
		_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/start", master.Token, map[string]any{}, &appt)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/complete", master.Token, map[string]any{
			"technique": "Демо seed окрашивание",
			"category_fields": map[string]any{
				"technique": "Демо seed окрашивание", "dye": "Majirel 7.1", "proportions": "1:1.5", "oxidizer": "6%",
			},
			"components": []map[string]any{
				{"name": "Majirel 7.1", "brand": "L'Oreal", "qty": "30", "unit": "г", "proportion": "1:1.5"},
			},
			"notes": "Создано seed",
		}, &appt)
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

	deliveryStep := func(id, step string) int {
		st, _ := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+id+"/delivery/"+step, supplier.Token, map[string]any{}, nil)
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
			st3 := transition(id, "ready_for_dispatch", nil)
			stPay := markPaid(id)
			log.Printf("ok supplier order flow id=%s confirmed=%d picking=%d ready=%d mark_paid=%d", id, st1, st2, st3, stPay)
		}
	} else {
		log.Printf("skip [seed-flow] order — already exists")
	}

	if !have["transit"] {
		id, err := createOrder("[seed-transit] Демо заказ (delivery in_transit)")
		if err != nil {
			log.Printf("warn create transit order: %v", err)
		} else {
			est := time.Now().UTC().AddDate(0, 0, 2)
			_ = transition(id, "confirmed", nil)
			stSched := scheduleDelivery(id)
			_ = transition(id, "picking", &est)
			_ = transition(id, "ready_for_dispatch", nil)
			st := deliveryStep(id, "in-transit")
			log.Printf("ok supplier order transit id=%s schedule=%d in_transit=%d", id, stSched, st)
		}
	} else {
		log.Printf("skip [seed-transit] order — already exists")
	}

	if !have["delivered"] {
		id, err := createOrder("[seed-delivered] Демо заказ (delivery delivered)")
		if err != nil {
			log.Printf("warn create delivered order: %v", err)
		} else {
			est := time.Now().UTC().AddDate(0, 0, 1)
			_ = transition(id, "confirmed", nil)
			stSched := scheduleDelivery(id)
			_ = transition(id, "picking", &est)
			_ = transition(id, "ready_for_dispatch", nil)
			_ = deliveryStep(id, "in-transit")
			_ = deliveryStep(id, "arrived")
			st := deliveryStep(id, "delivered")
			log.Printf("ok supplier order delivered via Delivery SoT id=%s schedule=%d delivered=%d", id, stSched, st)
		}
	} else {
		log.Printf("skip [seed-delivered] order — already exists")
	}

	return nil
}

func seedMaster2Inventory(c *http.Client, base string, master, supplier authUser, buyerOrgID, destBranchID string, productIDs []string) error {
	if buyerOrgID == "" || destBranchID == "" || len(productIDs) < 2 {
		return fmt.Errorf("missing master2 inventory deps")
	}
	var inv struct {
		Location struct {
			ID string `json:"id"`
		} `json:"location"`
	}
	st, err := doJSON(c, http.MethodGet, base+"/v1/me/inventory?organization_id="+buyerOrgID, master.Token, nil, &inv)
	if err != nil {
		return err
	}
	if st >= 300 || inv.Location.ID == "" {
		return fmt.Errorf("ensure master warehouse status %d", st)
	}

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
	supLoc, err := ensureLocation(c, base, supplier, supplierOrgID, "Склад поставщика", "supplier")
	if err != nil {
		return err
	}
	_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/stock/movements", supplier.Token, map[string]any{
		"location_id": supLoc, "product_id": productIDs[0], "kind": "receipt", "qty": 200, "reason": "phase5 master2 receive stock",
	}, nil)
	_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/stock/movements", supplier.Token, map[string]any{
		"location_id": supLoc, "product_id": productIDs[1], "kind": "receipt", "qty": 80, "reason": "phase5 master2 demo stock",
	}, nil)

	var existing struct {
		Items []struct {
			ID      string `json:"id"`
			Comment string `json:"comment"`
			Status  string `json:"status"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/supplier-orders?organization_id="+buyerOrgID, master.Token, nil, &existing)
	haveReceive, haveDemo := false, false
	for _, o := range existing.Items {
		if strings.Contains(o.Comment, "[seed-phase5-receive]") {
			haveReceive = true
		}
		if strings.Contains(o.Comment, "[seed-phase5-demo]") {
			haveDemo = true
		}
	}

	createAndDeliver := func(comment string, productID string, qty float64) (string, error) {
		var created struct {
			ID string `json:"id"`
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders", master.Token, map[string]any{
			"buyer_org_id": buyerOrgID, "supplier_org_id": supplierOrgID, "location_id": inv.Location.ID,
			"destination_branch_id": destBranchID, "payment_method": "bank_transfer", "comment": comment,
			"items": []map[string]any{{"product_id": productID, "qty": qty}},
		}, &created)
		if err != nil || status >= 300 {
			return "", fmt.Errorf("create phase5 order status %d %v", status, err)
		}
		est := time.Now().UTC().AddDate(0, 0, 1)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/transition", supplier.Token, map[string]any{"status": "confirmed"}, nil)
		windowStart := time.Now().UTC().Add(2 * time.Hour)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/delivery/schedule", supplier.Token, map[string]any{
			"window_start": windowStart, "window_end": windowStart.Add(3 * time.Hour),
			"planned_delivery_at": windowStart, "recipient_name": "Иван", "recipient_phone": "+79004445566",
		}, nil)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/transition", supplier.Token, map[string]any{"status": "picking", "estimated_delivery_at": est}, nil)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/transition", supplier.Token, map[string]any{"status": "ready_for_dispatch"}, nil)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/delivery/in-transit", supplier.Token, map[string]any{}, nil)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/delivery/arrived", supplier.Token, map[string]any{}, nil)
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+created.ID+"/delivery/delivered", supplier.Token, map[string]any{}, nil)
		return created.ID, nil
	}

	if !haveReceive {
		id, err := createAndDeliver("[seed-phase5-receive] Поставка для приёмки мастера", productIDs[0], 100)
		if err != nil {
			return err
		}
		log.Printf("ok master2 pending receipt order=%s", id)
	}
	if !haveDemo {
		id, err := createAndDeliver("[seed-phase5-demo] Принятый остаток мастера", productIDs[1], 20)
		if err != nil {
			return err
		}
		stAcc, err := doJSON(c, http.MethodPost, base+"/v1/commerce/supplier-orders/"+id+"/accept", master.Token, map[string]any{
			"items": []map[string]any{{"product_id": productIDs[1], "qty_accepted": 20, "qty_damaged": 0, "qty_rejected": 0}},
		}, nil)
		if err != nil || stAcc >= 300 {
			return fmt.Errorf("accept demo order status %d %v", stAcc, err)
		}
		log.Printf("ok master2 demo stock order=%s", id)
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
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/recurring?organization_id="+supplierOrgID+"&role=supplier", supplier.Token, nil, &list)
	if len(list.Items) > 0 {
		log.Printf("skip recurring — already %d", len(list.Items))
		return nil
	}
	start := time.Now().UTC().AddDate(0, 0, 7).Format("2006-01-02")
	var created struct {
		ID string `json:"id"`
	}
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

func cityLat(city string) float64 {
	switch strings.ToLower(strings.TrimSpace(city)) {
	case "красноярск":
		return 56.010543
	case "новосибирск":
		return 55.030199
	case "химки":
		return 55.889345
	default:
		return 55.755864
	}
}

func cityLng(city string) float64 {
	switch strings.ToLower(strings.TrimSpace(city)) {
	case "красноярск":
		return 92.852576
	case "новосибирск":
		return 82.920430
	case "химки":
		return 37.441029
	default:
		return 37.617698
	}
}

func seedAdminMembership(c *http.Client, base string, owner, admin authUser, orgID string) error {
	if admin.ID == "" || orgID == "" {
		return fmt.Errorf("missing admin or org")
	}
	status, err := doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/staff", owner.Token, map[string]any{
		"user_id": admin.ID, "role": "admin",
	}, nil)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("invite admin status %d", status)
	}
	return nil
}

func seedSalonEmployee(c *http.Client, base string, owner, employee, client authUser, orgID, branchID string) error {
	if employee.ID == "" || orgID == "" {
		return fmt.Errorf("missing employee or org")
	}
	status, err := doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/staff", owner.Token, map[string]any{
		"user_id": employee.ID, "role": "master",
	}, nil)
	if err != nil {
		return err
	}
	if status >= 300 && status != 409 {
		return fmt.Errorf("invite employee status %d", status)
	}
	elena := withOptionalPortrait(c, base, employee, masterSeed{
		Display: "Елена Сотрудник", Bio: "Мастер салона Анны, без собственного салона.",
		Specs: []string{"уход"}, Experience: 3, Education: "Salon Academy",
		City: "Красноярск", WorkType: "employee",
	})
	profileID, err := upsertMaster(c, base, employee, orgID, branchID, elena, false)
	if err != nil {
		return err
	}
	services, err := ensureServices(c, base, employee, orgID, []serviceSpec{
		{Name: "Уход сотрудника", Category: "уход", Description: "Уход мастера-сотрудника салона.", Duration: 60, Price: 250000},
	})
	if err != nil {
		return err
	}
	hours := make([]map[string]any, 0, 5)
	for wd := 1; wd <= 5; wd++ {
		hours = append(hours, map[string]any{"weekday": wd, "start_minute": 10 * 60, "end_minute": 19 * 60})
	}
	if st, err := doJSON(c, http.MethodPut, base+"/v1/me/working-hours", employee.Token, map[string]any{"items": hours}, nil); err != nil {
		return err
	} else if st >= 300 {
		return fmt.Errorf("employee hours status %d", st)
	}
	if published, err := upsertMaster(c, base, employee, orgID, branchID, elena, true); err == nil && published != "" {
		profileID = published
	}
	if len(services) == 0 || client.ID == "" {
		return nil
	}
	starts, err := findSlot(c, base, employee.ID, 60)
	if err != nil {
		return err
	}
	var appt struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	st, err := doJSON(c, http.MethodPost, base+"/v1/appointments", client.Token, map[string]any{
		"master_id": profileID, "service_id": services[0], "starts_at": starts,
	}, &appt)
	if err != nil {
		return err
	}
	if st >= 300 || appt.ID == "" {
		return fmt.Errorf("employee visit appt status %d", st)
	}
	if appt.Status == "pending_confirmation" || appt.Status == "pending" || appt.Status == "" {
		_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/confirm", employee.Token, map[string]any{}, &appt)
	}
	_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/start", employee.Token, map[string]any{}, &appt)
	stComplete, err := doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/complete", employee.Token, map[string]any{
		"skipped": true,
		"notes":   "Визит сотрудника салона",
	}, &appt)
	if err != nil {
		return err
	}
	if stComplete >= 300 {
		return fmt.Errorf("employee complete status %d", stComplete)
	}
	return nil
}

func seedHintPrefs(c *http.Client, base string, users map[string]authUser) error {
	u := users["premium1@demo.local"]
	if u.Token == "" {
		return nil
	}
	st, err := doJSON(c, http.MethodPatch, base+"/v1/me/hints", u.Token, map[string]any{
		"hints_enabled": false,
	}, nil)
	if err != nil {
		return err
	}
	if st >= 300 {
		return fmt.Errorf("hints patch status %d", st)
	}
	return nil
}

func seedChainOwner(c *http.Client, base string, user authUser) error {
	orgID, branchID, _, _, err := seedMaster(c, base, user, masterSeed{
		OrgName: "Сеть Salon-X (demo)", BranchName: "Красноярск",
		City: "Красноярск", Address: "ул. Мира, 10", Phone: "+79009990001", Timezone: "Asia/Krasnoyarsk",
		Display: "Сеть Salon-X", Bio: "Сеть из двух филиалов.",
		Specs: []string{"колористика", "уход"}, Experience: 10, Education: "Network Academy",
		WorkType: "chain_owner",
		Services: []serviceSpec{
			{Name: "Стрижка сети", Category: "стрижки", Description: "Стрижка в филиале сети.", Duration: 50, Price: 180000},
		},
	})
	if err != nil {
		return err
	}
	_, _ = doJSON(c, http.MethodPatch, base+"/v1/organizations/"+orgID, user.Token, map[string]any{
		"published": true,
	}, nil)
	lat, lng := 55.030199, 82.920430
	status, err := doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/branches", user.Token, map[string]any{
		"name": "Новосибирск", "city": "Новосибирск", "address_line": "Красный проспект, 1",
		"phone": "+79009990002", "timezone": "Asia/Novosibirsk", "latitude": lat, "longitude": lng,
	}, nil)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("second branch status %d", status)
	}
	log.Printf("ok chain org=%s first_branch=%s", orgID, branchID)
	return nil
}

func seedSubscriptions(c *http.Client, base string, users map[string]authUser) error {
	set := func(email, plan, status string, extra map[string]any) {
		u := users[email]
		if u.Token == "" {
			return
		}
		body := map[string]any{"plan": plan, "status": status}
		for k, v := range extra {
			body[k] = v
		}
		st, err := doJSON(c, http.MethodPost, base+"/v1/me/subscription/dev", u.Token, body, nil)
		if err != nil || st >= 300 {
			log.Printf("warn subscription %s status=%d err=%v", email, st, err)
		}
	}
	set("master4@demo.local", "free", "expired", nil)
	set("expired1@demo.local", "premium", "expired", map[string]any{
		"trial_ends_at": time.Now().UTC().AddDate(0, 0, -1).Format(time.RFC3339),
	})
	set("supplier1@demo.local", "premium", "active", map[string]any{
		"paid_until": time.Now().UTC().AddDate(0, 6, 0).Format(time.RFC3339),
	})
	set("master1@demo.local", "premium", "trial", nil)
	set("premium1@demo.local", "premium", "active", map[string]any{
		"paid_until": time.Now().UTC().AddDate(0, 6, 0).Format(time.RFC3339),
	})
	return nil
}

func seedNoShowScenario(c *http.Client, base string, oneShow, blacklisted, master authUser, profileID, serviceID string) error {
	if profileID == "" || serviceID == "" {
		return fmt.Errorf("missing profile/service")
	}
	bookNoShow := func(client authUser) error {
		starts, err := findSlot(c, base, master.ID, 60)
		if err != nil {
			return err
		}
		var appt struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		st, err := doJSON(c, http.MethodPost, base+"/v1/appointments", client.Token, map[string]any{
			"master_id": profileID, "service_id": serviceID, "starts_at": starts,
		}, &appt)
		if err != nil {
			return err
		}
		if st >= 300 || appt.ID == "" {
			return fmt.Errorf("create no-show appt status %d", st)
		}
		if appt.Status == "pending_confirmation" || appt.Status == "pending" || appt.Status == "" {
			_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/confirm", master.Token, map[string]any{}, &appt)
		}
		_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/no-show", master.Token, map[string]any{
			"reason": "seed no-show",
		}, nil)
		return nil
	}
	if err := bookNoShow(oneShow); err != nil {
		return err
	}
	if err := bookNoShow(blacklisted); err != nil {
		return err
	}
	if err := bookNoShow(blacklisted); err != nil {
		return err
	}
	return nil
}

func seedPlannerBlocks(c *http.Client, base string, master authUser) error {
	now := time.Now()
	start := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, now.Location())
	end := start.Add(45 * time.Minute)
	st, err := doJSON(c, http.MethodPost, base+"/v1/planner/blocks", master.Token, map[string]any{
		"title": "Обед", "category": "break",
		"starts_at": start.UTC().Format(time.RFC3339), "ends_at": end.UTC().Format(time.RFC3339),
		"timezone": "Asia/Krasnoyarsk", "color": "#7a7a7a",
	}, nil)
	if err != nil {
		return err
	}
	if st >= 300 {
		return fmt.Errorf("planner block status %d", st)
	}
	return nil
}

func listShopProductIDs(c *http.Client, base, token string) ([]string, error) {
	var list struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	st, err := doJSON(c, http.MethodGet, base+"/v1/commerce/shop/products?limit=50", token, nil, &list)
	if err != nil {
		return nil, err
	}
	if st >= 300 {
		return nil, fmt.Errorf("shop products status %d", st)
	}
	out := make([]string, 0, len(list.Items))
	for _, it := range list.Items {
		if it.ID != "" {
			out = append(out, it.ID)
		}
	}
	return out, nil
}

func checkoutShopOrder(c *http.Client, base, token string, body map[string]any) ([]string, error) {
	var resp struct {
		Orders []struct {
			ID string `json:"id"`
		} `json:"orders"`
		Order struct {
			ID string `json:"id"`
		} `json:"order"`
	}
	st, err := doJSON(c, http.MethodPost, base+"/v1/commerce/shop/checkout", token, body, &resp)
	if err != nil {
		return nil, err
	}
	if st >= 300 {
		return nil, fmt.Errorf("checkout status %d", st)
	}
	ids := make([]string, 0, len(resp.Orders))
	for _, o := range resp.Orders {
		if o.ID != "" {
			ids = append(ids, o.ID)
		}
	}
	if len(ids) == 0 && resp.Order.ID != "" {
		ids = []string{resp.Order.ID}
	}
	return ids, nil
}

func seedClientShopOrder(c *http.Client, base string, client authUser, productIDs []string, pickupBranchID string) error {
	if len(productIDs) == 0 {
		return fmt.Errorf("no products")
	}
	st, err := doJSON(c, http.MethodPut, base+"/v1/commerce/shop/cart/items", client.Token, map[string]any{
		"product_id": productIDs[0], "qty": 1,
	}, nil)
	if err != nil {
		return err
	}
	if st >= 300 {
		return fmt.Errorf("cart status %d", st)
	}
	_, err = checkoutShopOrder(c, base, client.Token, map[string]any{
		"delivery_address": "Салон Анны, ул. Ленина, 50",
		"delivery_comment": "seed pickup",
		"payment_method":   "cash_on_delivery",
		"pickup_branch_id": pickupBranchID,
	})
	return err
}

func seedClient2ShopHistory(c *http.Client, base string, client2, supplier, salonOwner, rep authUser, products1, products2 []string, pickupBranchID string) error {
	if client2.Token == "" || pickupBranchID == "" {
		return fmt.Errorf("missing seed inputs")
	}
	shopProducts, err := listShopProductIDs(c, base, client2.Token)
	if err != nil || len(shopProducts) < 4 {
		return fmt.Errorf("client2 shop products: %w", err)
	}
	p1 := shopProducts[0]
	p2 := shopProducts[1]
	p3 := shopProducts[2]
	p4 := shopProducts[3]
	var p5, p6 string
	if len(shopProducts) > 4 {
		p5 = shopProducts[4]
	}
	if len(shopProducts) > 5 {
		p6 = shopProducts[5]
	}
	// Prefer a second supplier item when available.
	for _, id := range shopProducts {
		if id != p1 && id != p2 && id != p3 && id != p4 {
			if p5 == "" {
				p5 = id
			} else if p6 == "" {
				p6 = id
				break
			}
		}
	}
	if p5 == "" {
		p5 = p2
	}
	if p6 == "" {
		p6 = p3
	}
	_ = products1
	_ = products2
	addr := "Салон Анны, ул. Ленина, 50"
	checkoutOne := func(productID string, comment string) (string, error) {
		st, err := doJSON(c, http.MethodPut, base+"/v1/commerce/shop/cart/items", client2.Token, map[string]any{
			"product_id": productID, "qty": 1,
		}, nil)
		if err != nil || st >= 300 {
			return "", fmt.Errorf("cart %d %v", st, err)
		}
		ids, err := checkoutShopOrder(c, base, client2.Token, map[string]any{
			"delivery_address": addr, "delivery_comment": comment,
			"payment_method": "cash", "pickup_branch_id": pickupBranchID,
		})
		if err != nil || len(ids) == 0 {
			return "", err
		}
		return ids[0], nil
	}
	advance := func(id, status string, repID string) {
		body := map[string]any{"status": status}
		if repID != "" {
			body["rep_user_id"] = repID
		}
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/shop/supplier/orders/"+id+"/transition", supplier.Token, body, nil)
	}
	completeRep := func(id string) {
		var order struct {
			Items []struct {
				ProductID string  `json:"product_id"`
				Qty       float64 `json:"qty"`
			} `json:"items"`
		}
		_, _ = doJSON(c, http.MethodGet, base+"/v1/commerce/shop/orders/"+id, client2.Token, nil, &order)
		items := make([]map[string]any, 0, len(order.Items))
		for _, it := range order.Items {
			items = append(items, map[string]any{"product_id": it.ProductID, "qty_delivered": it.Qty})
		}
		_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/rep/deliveries/"+id+"/complete", rep.Token, map[string]any{
			"items": items, "note": "seed", "amount_collected_minor": 89000, "payment_received": true,
		}, nil)
	}

	if _, err := checkoutOne(p1, "[client2] processing"); err != nil {
		return err
	}
	idConfirmed, err := checkoutOne(p2, "[client2] confirmed")
	if err != nil {
		return err
	}
	advance(idConfirmed, "confirmed", "")

	idDelivery, err := checkoutOne(p3, "[client2] in delivery")
	if err != nil {
		return err
	}
	advance(idDelivery, "confirmed", "")
	advance(idDelivery, "picking", "")
	if rep.ID != "" {
		advance(idDelivery, "in_delivery", rep.ID)
	}

	idReady, err := checkoutOne(p5, "[client2] ready for pickup")
	if err != nil {
		return err
	}
	advance(idReady, "confirmed", "")
	advance(idReady, "picking", "")
	if rep.ID != "" {
		advance(idReady, "in_delivery", rep.ID)
		completeRep(idReady)
	}
	_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/shop/pickup/orders/"+idReady+"/accept", salonOwner.Token, nil, nil)

	idReceived, err := checkoutOne(p6, "[client2] received")
	if err != nil {
		return err
	}
	advance(idReceived, "confirmed", "")
	advance(idReceived, "picking", "")
	if rep.ID != "" {
		advance(idReceived, "in_delivery", rep.ID)
		completeRep(idReceived)
	}
	_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/shop/pickup/orders/"+idReceived+"/accept", salonOwner.Token, nil, nil)
	_, _ = doJSON(c, http.MethodPost, base+"/v1/commerce/shop/pickup/orders/"+idReceived+"/handover", salonOwner.Token, map[string]any{
		"payment_received": true,
	}, nil)

	idCancel, err := checkoutOne(p4, "[client2] cancelled")
	if err != nil {
		return err
	}
	advance(idCancel, "cancelled", "")

	return nil
}

func seedRepRoute(c *http.Client, base string, supplier authUser, orgID, branchID string, rep authUser) error {
	var me struct {
		ID string `json:"id"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/me/representative", rep.Token, nil, &me)
	if me.ID == "" {
		return fmt.Errorf("rep profile missing")
	}
	lat, lng := cityLat("Красноярск"), cityLng("Красноярск")
	now := time.Now().UTC()
	win := func(h, m, durMin int) (string, string) {
		start := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, time.UTC)
		return start.Format(time.RFC3339), start.Add(time.Duration(durMin) * time.Minute).Format(time.RFC3339)
	}
	w0s, w0e := win(10, 0, 40)
	w1s, w1e := win(11, 30, 40)
	w2s, w2e := win(13, 0, 40)
	w3s, w3e := win(15, 0, 30)
	st, err := doJSON(c, http.MethodPost, base+"/v1/organizations/"+orgID+"/routes/recommend", supplier.Token, map[string]any{
		"representative_id": me.ID,
		"date":              time.Now().UTC().Format("2006-01-02"),
		"origin_lat":        lat,
		"origin_lng":        lng,
		"stops": []map[string]any{
			{"kind": "salon_visit", "branch_id": branchID, "latitude": lat, "longitude": lng, "priority": "high", "expected_duration_min": 25, "window_start": w0s, "window_end": w0e, "deadline_at": w0e},
			{"kind": "delivery", "latitude": lat + 0.012, "longitude": lng + 0.018, "priority": "normal", "expected_duration_min": 20, "window_start": w1s, "window_end": w1e, "deadline_at": w1e},
			{"kind": "delivery", "latitude": lat + 0.021, "longitude": lng - 0.01, "priority": "high", "expected_duration_min": 20, "window_start": w2s, "window_end": w2e, "deadline_at": w2e},
			{"kind": "work_task", "latitude": lat - 0.008, "longitude": lng + 0.007, "priority": "normal", "expected_duration_min": 15, "window_start": w3s, "window_end": w3e, "deadline_at": w3e},
		},
	}, nil)
	if err != nil {
		return err
	}
	if st >= 300 {
		return fmt.Errorf("recommend route status %d", st)
	}
	return nil
}

func lookupMasterServiceByName(c *http.Client, base string, user authUser, contains string) (string, error) {
	var me struct {
		Services []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"services"`
	}
	if _, err := doJSON(c, http.MethodGet, base+"/v1/me/master", user.Token, nil, &me); err != nil {
		return "", err
	}
	needle := strings.ToLower(contains)
	for _, s := range me.Services {
		if strings.Contains(strings.ToLower(s.Name), needle) {
			return s.ID, nil
		}
	}
	return "", fmt.Errorf("service matching %q not found", contains)
}

func seedBookInProgress(c *http.Client, base string, client, master authUser, profileID, serviceID string, durationMin int) (string, error) {
	if profileID == "" || serviceID == "" {
		return "", fmt.Errorf("missing profile/service")
	}
	starts, err := findSlot(c, base, master.ID, durationMin)
	if err != nil {
		return "", err
	}
	var appt struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	st, err := doJSON(c, http.MethodPost, base+"/v1/appointments", client.Token, map[string]any{
		"master_id": profileID, "service_id": serviceID, "starts_at": starts,
	}, &appt)
	if err != nil {
		return "", err
	}
	if st >= 300 || appt.ID == "" {
		return "", fmt.Errorf("create appointment status %d", st)
	}
	if appt.Status == "pending_confirmation" || appt.Status == "pending" || appt.Status == "" {
		_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/confirm", master.Token, map[string]any{}, &appt)
	}
	_, _ = doJSON(c, http.MethodPost, base+"/v1/appointments/"+appt.ID+"/start", master.Token, map[string]any{}, &appt)
	return appt.ID, nil
}

func seedCompleteAppointment(c *http.Client, base string, client, master authUser, profileID, serviceID string, durationMin int, body map[string]any) (string, error) {
	id, err := seedBookInProgress(c, base, client, master, profileID, serviceID, durationMin)
	if err != nil {
		return "", err
	}
	_, err = doJSON(c, http.MethodPost, base+"/v1/appointments/"+id+"/complete", master.Token, body, nil)
	return id, err
}

func seedPhase4Appointments(
	c *http.Client, base string, users map[string]authUser,
	master1 authUser, m1Profile, m1Service string,
	master4 authUser, m4Profile string,
	premium1 authUser, p1Profile, p1Service string,
	expired1 authUser, e1Profile, e1Service string,
) error {
	client2 := users["client2@demo.local"]
	client1 := users["client1@demo.local"]

	m1Color, err := lookupMasterServiceByName(c, base, master1, "Окрашивание")
	if err != nil {
		m1Color = m1Service
	}
	m4Color, err := lookupMasterServiceByName(c, base, master4, "Phase4")
	if err != nil {
		return err
	}

	if id, err := seedBookInProgress(c, base, client2, master4, m4Profile, m4Color, 120); err != nil {
		return fmt.Errorf("free in_progress: %w", err)
	} else {
		log.Printf("ok phase4 free in_progress appt=%s master4", id)
	}
	if id, err := seedBookInProgress(c, base, client1, master1, m1Profile, m1Color, 180); err != nil {
		log.Printf("warn trial in_progress: %v", err)
	} else {
		log.Printf("ok phase4 trial in_progress appt=%s master1", id)
	}
	if p1Profile != "" && p1Service != "" {
		if id, err := seedBookInProgress(c, base, client1, premium1, p1Profile, p1Service, 120); err != nil {
			log.Printf("warn premium in_progress: %v", err)
		} else {
			log.Printf("ok phase4 premium in_progress appt=%s premium1", id)
		}
	}
	if e1Profile != "" && e1Service != "" {
		if id, err := seedBookInProgress(c, base, client1, expired1, e1Profile, e1Service, 120); err != nil {
			log.Printf("warn expired in_progress: %v", err)
		} else {
			log.Printf("ok phase4 expired in_progress appt=%s expired1", id)
		}
	}

	if id, err := seedCompleteAppointment(c, base, client1, master4, m4Profile, m4Color, 120, map[string]any{
		"technique": "Seed Phase4 Free",
		"category_fields": map[string]any{
			"technique": "Seed Phase4 Free", "dye": "Majirel 7.1", "proportions": "1:1.5", "oxidizer": "6%",
		},
		"components": []map[string]any{{"name": "Majirel 7.1", "qty": "30", "unit": "г", "proportion": "1:1.5"}},
		"notes":      "Phase4 completed scheme",
	}); err != nil {
		log.Printf("warn completed scheme: %v", err)
	} else {
		log.Printf("ok phase4 completed scheme appt=%s", id)
	}

	if p1Profile != "" && p1Service != "" {
		if id, err := seedCompleteAppointment(c, base, client1, premium1, p1Profile, p1Service, 120, map[string]any{
			"skipped": true,
		}); err != nil {
			log.Printf("warn completed skipped: %v", err)
		} else {
			log.Printf("ok phase4 completed skipped appt=%s premium1", id)
		}
	}
	return nil
}

func fatal(format string, args ...any) {
	log.Printf("error: "+format, args...)
	os.Exit(1)
}
