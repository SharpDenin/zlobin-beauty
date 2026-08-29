# Seed media

Realistic demo photographs for `go run ./cmd/seed`. Seed does not download images and does not upload 1×1 PNG placeholders.

Override the root with `SEED_MEDIA_DIR` if needed. By default the seeder walks up from the working directory until it finds `seed/media`.

JPEG, PNG, and WebP are accepted for images. Keep files under 5 MiB (50 MiB for video). Missing files are skipped: the entity stays without media (`NULL`), and the UI uses the `MediaImage` system fallback.

Re-runs reuse already attached real photos. Tiny leftover placeholders (`size_bytes < 2048`) are replaced when a matching file exists.

## Layout

| Path | Purpose | Mapping |
| --- | --- | --- |
| `masters/{email-local}.jpg` | Master portrait (`purpose=profile`) | `master1@demo.local` → `masters/master1.jpg` |
| `salons/{slug}.jpg` | Salon / branch photo (`purpose=salon`) | Attached via `POST /v1/branches/{id}/photos` |
| `services/{slug}.jpg` | Service photo (`purpose=service`) | Slug is the lowercased name with spaces → `-` (e.g. `стрижка.jpg`) |
| `products/{SKU}.jpg` | Product photo (`purpose=product`) | Matches the product SKU. Omit the file to keep `photo_media_id` null |
| `articles/coloring.jpg`, `care.jpg`, `home.jpg`, `styling.jpg`, `salon.jpg` | Knowledge covers (`purpose=article`) | Chosen from article category/title |
| `articles/cover.jpg` | Fallback knowledge cover | Used when a category file is missing |
| `articles/inline.jpg` | Inline article image | Optional |
| `articles/demo.webm` | Demo video (`purpose=video`) | Optional |

## Intentional gaps

Some catalog rows stay without photos on purpose:

- Services: `Борода`, `Снятие покрытия`, `Окрашивание бровей`, `Уход сотрудника`, `Тонирование`, Phase4 technical services, `Стрижка сети`
- Products: `S1-OLA-N0`, `S1-EST-DLX-OX6`, `S1-RACE-001`, `S2-LOR-SE-BD`
