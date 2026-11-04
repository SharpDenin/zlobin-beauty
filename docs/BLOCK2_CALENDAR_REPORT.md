# Блок 2 — Аудит и переработка календаря Salon-X

**Дата:** 2026-11-04  
**Среда:** local Docker `127.0.0.1:5173` + seed  
**Референс:** нижний левый экран «Расписание» (Midnight/Signal)

---

## 1. Аудит: что не соответствовало

| Требование / референс | Было |
| --- | --- |
| Мобильный день = список слотов | На ≤599 px «День» шёл через **FullCalendar** timeGrid; day-list в `CalendarMobile` существовал, но **не монтировался** (только месяц). |
| `docs/CALENDAR.md` | Устаревший: обещал мобильный day-list. |
| Свободные слоты из графика мастера | Список (если бы включали) брал **диапазон отображения 08–22**, а не weekly hours / exceptions. |
| Занято = приглушённо + «Занято» | CSS `.is-busy` не применялся; занятость только карточками событий. |
| Компактный заголовок + выбор даты | Плотный page-head + FC toolbar; date picker отсутствовал. |
| Лента дат | Была в `CalendarMobile`, но не на экране «День». |
| Выходной с записями | EmptyState «Выходной» скрывал существующие appointments (исключение day_off + записи в seed на 2026-11-04). |

Роли, API booking/planner, FreeSlots для клиента, long press 500/16, длительность услуги и overlap на сервере — **без расхождения по контракту**.

---

## 2. Изменённые файлы

- `frontend/src/pages/CalendarPage.tsx` — `showMobileDayList` для `timeGridDay` + `dayGridMonth`
- `frontend/src/pages/CalendarMobile.tsx` — day UI по референсу, слоты из графика, busy/free, date picker
- `frontend/src/pages/calendar.css` — визуал ленты и слотов
- `frontend/src/pages/calendar-helpers.ts` — `resolveDayWorkWindow`, `eventCoversSlot`
- `frontend/src/pages/calendar-helpers.test.ts`
- `frontend/e2e/calendar.spec.ts`, `frontend/e2e/calendar-stabilize.spec.ts`
- `docs/CALENDAR.md`
- `docs/BLOCK2_CALENDAR_REPORT.md` (этот отчёт)
- Скриншоты: `docs/qa01-artifacts/cal-block2-*.png`

---

## 3. Поведение по ролям

| Роль | Поведение |
| --- | --- |
| Владелец / admin салона | Org calendar API, фильтр мастера/филиала; на телефоне день — тот же list UI с заголовком «Расписание». |
| Мастер салона / частный мастер | `/v1/appointments/mine` + свои hours/blocks; day-list по своему графику. |
| Клиент | Экран `/calendar` не для выбора слота; визард на `MasterPage` + `GET /v1/masters/{id}/slots` без изменений модели. |
| ≥600 px | Day/week/month/list — FullCalendar как раньше; drag/resize задач и reschedule записей на сетке. |

---

## 4. Исправленные функциональные дефекты

1. Мобильный «День» снова показывает list UI (лента + слоты).
2. Слоты считаются из **рабочего окна** дня (weekly hours + exceptions), не из display range.
3. Свободные — акцент; продолжение занятости — «Занято»; старт события — карточка.
4. Date picker в шапке day-list.
5. Day-off с существующими записями показывает события, а не пустой выходной.
6. При уходе с FullCalendar на day-list расширяется окно fetch (`ensureRangeCovers`), иначе соседние дни теряли appointments после узкого datesSet.
7. Документация и e2e приведены к FC/list разделению.

**Не менялось:** API-контракты, правила confirmation/status, расчёт FreeSlots на сервере, роли, смешение задач и записей, 500 ms / 16 px long press.

---

## 5. Правила записей / задач / доступности

Подтверждено сохранение:

- Длительность записи = услуга; reschedule меняет start.
- Planner blocks отдельно; overlap/hours на backend.
- Клиентские слоты — `FreeSlots` (hours − appts − blocks − work modes).
- Long press: 500 ms, slop 16 px.

---

## 6. Тесты

```bash
cd frontend
npx vitest run src/pages/calendar-helpers.test.ts
# 15 passed

# E2E (нужен healthy API :8090):
npx playwright test e2e/calendar.spec.ts --project=phone-390
npx playwright test e2e/calendar-stabilize.spec.ts --project=phone-390
```

---

## 7. Адаптив (целевые ширины)

| Ширина | Ожидание |
| --- | --- |
| 360 / 390 | Day-list: лента слева направо, слоты на всю ширину, без page overflow-x, отступ под bottom nav |
| 768+ | FullCalendar день/неделя; без принудительного list |
| 1024 / 1440 | Неделя/месяц FC, фильтры владельца |

---

## 8. Скриншоты

- `docs/qa01-artifacts/cal-block2-390-day.png` — мобильный день
- `docs/qa01-artifacts/cal-block2-1440-week.png` — широкий экран

---

## 9. Ограничения

- Физические жесты (swipe vs scroll) на iPhone/Samsung — ручная проверка.
- Drag записи на телефоне в day-list нет (перенос через карточку/диалог); drag остаётся на FC (3 дня / desktop / неделя).
- Клиентский визард слотов — chip grid свободного времени, не timeline «занято» (по BOOKING.md это корректно).
- Seed: 2026-11-04 — exception day_off при наличии записей; UI теперь их показывает.
- Полный прогон всех 16 UI-сценариев ролей на staging желателен после деплоя.

---

## 10. BLOCK 2.1 — адаптивные правки (2026-11-05)

### Первопричины

| Проблема | Причина |
| --- | --- |
| Наложение / обрезанная лента дат | Sticky `cal-mobile-head` + `cal-day-strip` внутри одного scroll-контейнера + `overflow:hidden` shell → strip сжимался/перекрывался; `state-box success` конкурировал с кнопками head |
| Нет «Неделя» | Compact remap `timeGridWeek` → `timeGridThreeDay`; одна кнопка «3 дня» вместо двух режимов |
| Дубль success | `setOk` + `toast.success` + постоянный `.state-box.success` |
| Фильтры в основном UI | `.calendar-category-row` всегда в chrome; на day CSS прятал, на остальных режимах — нет |

### Исправления

1. **Layout day:** `cal-mobile-chrome` (head + strip, `flex-shrink:0`) и `cal-mobile-body` (слоты, `overflow-y:auto`); sticky убран.
2. **Лента дат:** `min-height:64px`, `touch-action:pan-x`, выбранный день `scrollIntoView`; без page overflow-x.
3. **Неделя:** отдельные вкладки День / 3 дня / Неделя / Месяц / Список; FC `timeGridWeek` на mobile; remap снят.
4. **Toast only:** удалён success banner и state `ok`; успех только через `toast.success`; ошибки — `ErrorBanner` / `toast.error`.
5. **Фильтры:** панель категорий только в «Настройки календаря» → «Показ категорий» (тот же `hidden` / `setHidden`).

### Файлы 2.1

- `frontend/src/pages/CalendarPage.tsx`
- `frontend/src/pages/CalendarMobile.tsx`
- `frontend/src/pages/calendar.css`
- `frontend/e2e/calendar.spec.ts`
- `frontend/e2e/calendar-stabilize.spec.ts`
- `docs/CALENDAR.md`
- `docs/BLOCK2_CALENDAR_REPORT.md`

### Проверка

- Vitest `calendar-helpers.test.ts` — 15/15.
- Browser **360 / 390**: tabs `sameRow=true`, `overflow-x:auto`, stripH≈74, chrome/body без overlap, `catMain=0`, `successBox=false`, `pageOX=false`.
- **Неделя** на 390: FC 7 колонок (пн–вс), page overflow-x = false.
- Фильтры только в settings («Показ категорий»).
- Скриншоты:  
  - `docs/qa01-artifacts/cal-block21-390-day.png`  
  - `docs/qa01-artifacts/cal-block21-360-day.png`  
  - `docs/qa01-artifacts/cal-block21-390-settings.png`  
  - `docs/qa01-artifacts/cal-block21-390-week.png`
