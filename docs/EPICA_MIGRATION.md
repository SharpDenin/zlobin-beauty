# EPICA-01 — перенос данных Epica (knowledge) в production

Инструмент: `backend/cmd/epica-migrate`.

Переносятся **только** материалы базы знаний бренда **EPICA Professional** и их обложки в media/MinIO.  
Демо-пользователи, салоны, заказы, портфолио и прочие тестовые данные **не** переносятся.

**В рамках разработки инструмента фактический `--apply` в production запрещён.**

---

## 1. Что считается данными Epica

| Источник | Условие отбора |
|---|---|
| `marketplace.knowledge_articles` | `brand = 'EPICA Professional'` |
| `media.media_objects` | `id IN (DISTINCT cover_media_id)` статей выше |
| MinIO bucket | объекты с `object_key` из этих `media_objects` |

Связанные, но **не** переносимые:

- `knowledge_favorites` (пользовательские избранные)
- `knowledge_article_products` / `knowledge_article_categories` (для Epica обычно пусто)
- `identity.users`, `organizations.*`, memberships, reps
- commerce `products` (Epica в каталоге shop отсутствует)
- `portfolio_items` (даже если seed использовал файлы из `seed/media/epica`)

Локальный автор статей — demo `supplier1@demo.local` и org «ПрофиКосмет». В production они **не создаются**: нужен mapping на уже существующие supplier user/org.

---

## 2. Карта переноса

| Источник | Назначение | ID | Зависимости |
|---|---|---|---|
| `media_objects` | `media_objects` | сохраняем UUID | `owner_user_id` ← mapping.users |
| MinIO object | тот же `object_key` / bucket target | ключ сохраняется | файл из export |
| `knowledge_articles` | `knowledge_articles` | сохраняем UUID | `author_user_id`/`author_org_id` ← mapping; `cover_media_id` уже вставлен |

Порядок: **MinIO → media_objects → knowledge_articles**.

Конфликты:

- тот же `id`, другое содержимое/sha → **BLOCK**, без overwrite;
- тот же `object_key`, другой media id/size → **BLOCK**;
- повторный запуск при полном совпадении → skip (идемпотентно).

---

## 3. Требования к доступу

Нужны **отдельные** DSN (не коммитить):

- `SOURCE_*` — локальная/staging БД + MinIO (чтение)
- `TARGET_*` — production (для dry-run: желательно read-only роль; для import — write)

Переменные:

```text
SOURCE_MARKETPLACE_DATABASE_URL
SOURCE_MEDIA_DATABASE_URL
SOURCE_IDENTITY_DATABASE_URL          # только для проверок / export helper
SOURCE_ORGANIZATIONS_DATABASE_URL
SOURCE_MINIO_ENDPOINT
SOURCE_MINIO_ACCESS_KEY
SOURCE_MINIO_SECRET_KEY
SOURCE_MINIO_BUCKET=zlobin-media
SOURCE_MINIO_USE_SSL=false

TARGET_MARKETPLACE_DATABASE_URL
TARGET_MEDIA_DATABASE_URL
TARGET_IDENTITY_DATABASE_URL
TARGET_ORGANIZATIONS_DATABASE_URL
TARGET_MINIO_ENDPOINT
TARGET_MINIO_ACCESS_KEY
TARGET_MINIO_SECRET_KEY
TARGET_MINIO_BUCKET
TARGET_MINIO_USE_SSL=true
```

Credentials только в секрет-хранилище / CI secrets / локальном env-файле вне git.

---

## 4. Backup production (обязательно до import)

Перед любым `--apply`:

1. Logical dump сервисов `marketplace` и `media` (и snapshot MinIO bucket).
2. Проверить, что backup восстанавливается на staging.
3. Зафиксировать время backup и ответственного.

Пример (адаптировать под ваш хостинг):

```bash
pg_dump "$TARGET_MARKETPLACE_DATABASE_URL" -Fc -f marketplace_pre_epica.dump
pg_dump "$TARGET_MEDIA_DATABASE_URL" -Fc -f media_pre_epica.dump
# MinIO / S3: versioning snapshot или mc mirror в отдельный bucket
```

---

## 5. Mapping ID

Шаблон: `scripts/epica-mapping.example.json`.

После `export` можно сгенерировать файл с локальными UUID:

```bash
go run ./cmd/epica-migrate export \
  --out ./epica-export \
  --write-mapping-example ./epica-mapping.local.json
```

Замените значения справа на **реальные** production UUID supplier-пользователя и supplier-организации.  
Mapping `src → src` для production **запрещён** (кроме локального флага `--allow-identity-passthrough`).

---

## 6. Проверка подключений

```bash
# из каталога backend/
go run ./cmd/epica-migrate dry-run --assume-empty-target --mapping ./epica-mapping.local.json
# или live source без export:
# (SOURCE_* должны быть заданы)
```

Успешный ping SOURCE/TARGET выполняется внутри команд `export` / `dry-run` / `import`.

---

## 7. Export (из локальной БД)

На Windows Docker host→`localhost:5433` может давать EOF; надёжнее запускать linux-бинарь **внутри сети compose** (`zlobin-beauty_default`).

```bash
cd backend
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ../bin/epica-migrate-linux ./cmd/epica-migrate

docker run --rm --network zlobin-beauty_default \
  -v "$PWD/../bin/epica-migrate-linux:/epica-migrate:ro" \
  -v "$PWD/../epica-export:/out" \
  -v "$PWD/..:/work" \
  -e SOURCE_MARKETPLACE_DATABASE_URL='postgres://marketplace:marketplace@postgres:5432/marketplace?sslmode=disable' \
  -e SOURCE_MEDIA_DATABASE_URL='postgres://media:media@postgres:5432/media?sslmode=disable' \
  -e SOURCE_MINIO_ENDPOINT='minio:9000' \
  -e SOURCE_MINIO_ACCESS_KEY='…' \
  -e SOURCE_MINIO_SECRET_KEY='…' \
  -e SOURCE_MINIO_BUCKET='zlobin-media' \
  -e SOURCE_MINIO_USE_SSL='false' \
  alpine:3.20 sh -c 'cp /epica-migrate /tmp/e && chmod +x /tmp/e && /tmp/e export --out /out --write-mapping-example /work/epica-mapping.local.json'
```

Артефакты: `epica-export/manifest.json`, `epica-export/objects/*`.

---

## 8. Dry-run

### 8.1 Планирование «пустой приёмник»

```bash
go run ./cmd/epica-migrate dry-run \
  --export ./epica-export \
  --assume-empty-target \
  --mapping ./epica-mapping.local.json \
  --report ./epica-dry-run-empty.json
```

### 8.2 Против реального TARGET (read-only предпочтительно)

```bash
# задать TARGET_* (DSN + MinIO)
go run ./cmd/epica-migrate dry-run \
  --export ./epica-export \
  --mapping ./epica-mapping.prod.json \
  --report ./epica-dry-run-prod.json
```

### 8.3 Локальная идемпотентность (только dev)

```bash
# TARGET_* = те же, что SOURCE_*; mapping src→src
go run ./cmd/epica-migrate dry-run \
  --export ./epica-export \
  --mapping ./epica-mapping.passthrough.json \
  --allow-identity-passthrough \
  --report ./epica-dry-run-local-exists.json
```

Интерпретация:

| Поле | Смысл |
|---|---|
| `safe: true` | можно планировать import |
| `would_create` | будут вставлены |
| `already_exists` | совпали PK и содержимое — skip |
| `conflicts` | BLOCK, ручной разбор |
| `missing_deps` / mapping errors | нет production user/org |
| files `copy` / `present` / `conflict` | план по MinIO |

---

## 9. Import (только после SAFE dry-run)

```bash
go run ./cmd/epica-migrate import \
  --export ./epica-export \
  --mapping ./epica-mapping.prod.json \
  --apply
```

Журнал: `epica-export/import-journal.json` (этапы minio → media → articles).

Повторный запуск безопасен: существующие совпадающие строки/объекты пропускаются; конфликты останавливают процесс без overwrite.

---

## 10. Проверка результата

```sql
-- marketplace
SELECT count(*) FROM knowledge_articles WHERE brand = 'EPICA Professional';
SELECT count(*) FROM knowledge_articles
 WHERE brand = 'EPICA Professional' AND cover_media_id IS NOT NULL;

-- media
SELECT count(*) FROM media_objects
 WHERE id IN (
   SELECT cover_media_id FROM knowledge_articles
    WHERE brand = 'EPICA Professional' AND cover_media_id IS NOT NULL
 );
```

В UI: база знаний → фильтр бренда «EPICA Professional», открыть карточку с обложкой.

---

## 11. Откат

1. Остановить import при ошибке (журнал покажет незавершённый этап).
2. Восстановить `marketplace` и `media` из dump §4.
3. Для MinIO — вернуть bucket из snapshot / удалить только ключи, добавленные журналом (осторожно: не трогать чужие объекты).

Автоматический rollback между тремя хранилищами не гарантируется одной XA-транзакцией — поэтому backup обязателен.

---

## 12. Ограничения

- Нет схемы-миграций: требуется актуальная schema knowledge/media на TARGET.
- `view_count` переносится как в источнике (обычно 0).
- Не переносим избранное и demo ACL.
- Production `--apply` выполняется оператором вручную после приёмки dry-run.
