-- commerce: catalog, stock, movements, norms, supplier orders (Stage 3 foundation)
CREATE TABLE product_categories (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    category_id UUID REFERENCES product_categories(id),
    brand TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'pcs',
    volume_label TEXT NOT NULL DEFAULT '',
    price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'RUB',
    min_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX products_org_sku_uidx ON products(organization_id, sku) WHERE sku <> '';
CREATE INDEX products_org_idx ON products(organization_id);
CREATE INDEX products_published_idx ON products(published) WHERE published;

CREATE TABLE stock_locations (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('salon', 'master', 'supplier', 'transit')),
    owner_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX stock_locations_org_idx ON stock_locations(organization_id);

CREATE TABLE stock_balances (
    location_id UUID NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty_on_hand NUMERIC(12,3) NOT NULL DEFAULT 0,
    qty_reserved NUMERIC(12,3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (location_id, product_id)
);

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY,
    location_id UUID NOT NULL REFERENCES stock_locations(id),
    product_id UUID NOT NULL REFERENCES products(id),
    kind TEXT NOT NULL CHECK (kind IN ('receipt', 'consumption', 'adjust', 'write_off', 'return', 'reserve', 'unreserve')),
    qty NUMERIC(12,3) NOT NULL,
    qty_before NUMERIC(12,3) NOT NULL,
    qty_after NUMERIC(12,3) NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    actor_user_id UUID NOT NULL,
    ref_type TEXT NOT NULL DEFAULT '',
    ref_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX stock_movements_loc_idx ON stock_movements(location_id, created_at DESC);

CREATE TABLE consumption_norms (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    service_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id),
    qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
    required BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (service_id, product_id)
);

CREATE TABLE supplier_orders (
    id UUID PRIMARY KEY,
    buyer_org_id UUID NOT NULL,
    supplier_org_id UUID NOT NULL,
    location_id UUID NOT NULL REFERENCES stock_locations(id),
    status TEXT NOT NULL CHECK (status IN (
        'draft', 'new', 'confirmed', 'picking', 'in_transit',
        'delivered', 'accepted_partial', 'accepted_full', 'cancelled'
    )),
    currency TEXT NOT NULL DEFAULT 'RUB',
    total_minor BIGINT NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    desired_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX supplier_orders_buyer_idx ON supplier_orders(buyer_org_id, created_at DESC);
CREATE INDEX supplier_orders_supplier_idx ON supplier_orders(supplier_org_id, created_at DESC);

CREATE TABLE supplier_order_items (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    qty_ordered NUMERIC(12,3) NOT NULL CHECK (qty_ordered > 0),
    qty_delivered NUMERIC(12,3) NOT NULL DEFAULT 0,
    qty_accepted NUMERIC(12,3) NOT NULL DEFAULT 0,
    price_minor BIGINT NOT NULL CHECK (price_minor >= 0)
);

CREATE INDEX supplier_order_items_order_idx ON supplier_order_items(order_id);

CREATE TABLE import_jobs (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    kind TEXT NOT NULL,
    checksum TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('validated', 'applied', 'failed')),
    report JSONB NOT NULL DEFAULT '{}',
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, kind, checksum)
);
