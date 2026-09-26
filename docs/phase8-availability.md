# Phase 8 — Smart service provisioning

Canonical availability analysis for a service against the **caller’s master warehouse**. Phases 5–7 stay the source of truth; this phase does not add a second inventory, order, formula, or calendar system.

## Source of truth

| Question | Source |
| --- | --- |
| Required materials | `consumption_norms` aggregated by `product_id` |
| Current stock | `stock_balances` on `EnsureMasterLocation` (`kind=master`, owner = JWT) |
| Available | `qty_on_hand − qty_reserved` |
| Incoming | `IncomingRemainingByLocation` (ordered − accepted − damaged − rejected) on **this** master location |
| Orderable | Existing catalog: `published && for_sale && not archived`, product org ≠ buyer org |
| Consumption | `POST /v1/me/inventory/consume` → `stock_movements` (`kind=consumption`) |
| Alternative | Catalog `parent_id` siblings already in master stock. Never generated chemistry. |

Salon stock and supplier warehouse stock are **not** fallbacks for master availability.

Incoming is **not** stock. Accept turns remaining incoming into a receipt movement. Draft/cart orders are not incoming (same statuses as Phase 7).

`qty_reserved` is the existing shop-checkout reservation. Phase 8 accounts for it in `available` and does not add an appointment reservation state machine.

Salon auto-consume on appointment complete still uses salon location. Master stock is consumed only through the explicit master consume flow.

## Statuses

- `available` — current available ≥ required
- `incoming` — current available is short, remaining incoming covers the gap
- `orderable` — stock + incoming still short, product can be ordered in the existing catalog
- `shortage` — short, and the product is not catalog-orderable, but some stock/incoming exists
- `unavailable` — nothing on hand or incoming, and not catalog-orderable

`can_perform_now` is true only when every line is `available`.

## API

`GET /v1/me/inventory/availability?organization_id&service_id&appointment_id?`

Actor is JWT. Owner/admin of the salon do not receive another master’s personal stock; they get their own master location if they have one.

Phase 7 `POST /v1/internal/inventory/repeat-availability` is a thin wrapper over the same analyzer.

When `appointment_id` is set, required qty is reduced by consumption movements with `ref_type=appointment` and that `ref_id` only.

The analyzer does not return formula brand/name/components/oxidizer/ratio/comment. Those stay behind Phase 2 visit visibility.

## Quick order

The UI links to the existing cosmetics product page / cart / supplier order flow. No second checkout.

## Known limitation

Color formulas store component **names**, not `product_id`. If there is no catalog `parent_id` sibling with enough master stock, `alternative.available` is `false` with reason «Нет сохранённой альтернативы».
