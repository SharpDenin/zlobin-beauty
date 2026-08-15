-- Recurring professional supply agreements with rolling-horizon generation.

CREATE TABLE recurring_agreements (
    id UUID PRIMARY KEY,
    supplier_org_id UUID NOT NULL,
    buyer_org_id UUID NOT NULL,
    pickup_branch_id UUID NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
    preferred_weekday SMALLINT CHECK (preferred_weekday BETWEEN 0 AND 6),
    window_start_minute INT CHECK (window_start_minute >= 0 AND window_start_minute < 1440),
    window_end_minute INT CHECK (window_end_minute > 0 AND window_end_minute <= 1440),
    start_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'active', 'paused', 'rejected', 'cancelled', 'pending_reconfirm'
    )),
    proposed_change JSONB,
    horizon_days INT NOT NULL DEFAULT 28 CHECK (horizon_days > 0 AND horizon_days <= 90),
    created_by UUID NOT NULL,
    decided_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recurring_agreements_supplier_idx ON recurring_agreements(supplier_org_id, status);
CREATE INDEX recurring_agreements_buyer_idx ON recurring_agreements(buyer_org_id, status);

CREATE TABLE recurring_agreement_items (
    id UUID PRIMARY KEY,
    agreement_id UUID NOT NULL REFERENCES recurring_agreements(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
    last_known_price_minor BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX recurring_agreement_items_agreement_idx ON recurring_agreement_items(agreement_id);

CREATE TABLE recurring_exceptions (
    id UUID PRIMARY KEY,
    agreement_id UUID NOT NULL REFERENCES recurring_agreements(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('price_change', 'product_unavailable', 'manual')),
    message TEXT NOT NULL,
    product_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE recurring_generated_orders (
    agreement_id UUID NOT NULL REFERENCES recurring_agreements(id) ON DELETE CASCADE,
    occurrence_date DATE NOT NULL,
    order_id UUID NOT NULL REFERENCES supplier_orders(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agreement_id, occurrence_date)
);
