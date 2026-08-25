# Phase 9 — Knowledge recommendations

Knowledge stays in **marketplace**. Phase 8 remains the only availability analyzer. Phases 5–7 remain inventory, receiving, and repeat.

## Source of truth

| Question | Source |
| --- | --- |
| Articles / search / categories | Existing `knowledge_articles` + facets |
| Product link | `knowledge_article_products` / `product_id` |
| Service link | `consumption_norms` for `service_id` + `organization_id` → product IDs → same product join |
| Appointment context | Booking `GET /v1/appointments/{id}` with caller JWT; only `service_id` and `organization_id` are read |
| Availability / shortage / incoming | Phase 8 `GET /v1/me/inventory/availability` |
| Alternative | Phase 8 catalog `parent_id` siblings already in master stock. Never invented chemistry |

No new tables. No second knowledge system, inventory, or availability engine.

## Recommendations

`GET /v1/me/knowledge/recommendations`

Caller JWT required. One `ListKnowledge` query with `product_id = ANY(...)`. Norms and appointment metadata are fetched once each, not per article.

Response is a short list DTO: id, title, excerpt, category, context, product ids. It does not include stock quantities, formula, oxidizer, components, or scheme fields.

If nothing is linked:

- product: «Для этого материала нет сохранённой рекомендации»
- service: «Для этой услуги нет сохранённых материалов»

## UI

Existing `/knowledge` hub, product page, inventory «База знаний», calendar/appointment availability panel, and repeat preview. Knowledge never mutates appointments, stock, or orders.
