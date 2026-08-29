# Seed media (next phase)

Place **real photographs** here. Seed does not download images and no longer uploads 1×1 PNG placeholders.

Override the root with `SEED_MEDIA_DIR` if needed. By default the seeder walks up from the working directory until it finds `seed/media`.

## Layout

| Path | Purpose | When attached |
| --- | --- | --- |
| `masters/{email-local}.jpg` | Master portrait (`purpose=profile`) | `master1@demo.local` → `masters/master1.jpg` |
| `services/{slug}.jpg` | Service photo (`purpose=service`) | Slug is the lowercased name with spaces → `-` (e.g. `стрижка-женская.jpg`) |
| `products/{SKU}.jpg` | Product photo (`purpose=product`) | Matches the product SKU in seed |
| `articles/cover.jpg` | Knowledge cover (`purpose=article`) | Optional; articles seed without a cover if missing |
| `articles/inline.jpg` | Inline article image | Optional |
| `articles/demo.webm` | Demo video (`purpose=video`) | Optional |
| `salons/` | Salon photos (`purpose=salon`) | Reserved for the realistic seed phase |

JPEG, PNG, and WebP are accepted for images. Keep files under 5 MiB (50 MiB for video).

Until files exist, services/masters/products are valid **without** media. The UI uses `MediaImage` system fallback.
