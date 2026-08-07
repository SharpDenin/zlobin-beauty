-- client shopping cart (one open cart per user)
CREATE TABLE client_carts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_cart_items (
  cart_id UUID NOT NULL REFERENCES client_carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE client_orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  supplier_org_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'submitted','confirmed','picking','in_delivery','delivered','cancelled'
  )),
  currency TEXT NOT NULL DEFAULT 'RUB',
  total_minor BIGINT NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  delivery_address TEXT NOT NULL DEFAULT '',
  delivery_comment TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery',
  rep_user_id UUID,
  delivered_at TIMESTAMPTZ,
  delivery_note TEXT NOT NULL DEFAULT '',
  amount_collected_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_orders_user_idx ON client_orders(user_id, created_at DESC);
CREATE INDEX client_orders_supplier_idx ON client_orders(supplier_org_id, status, created_at DESC);
CREATE INDEX client_orders_rep_idx ON client_orders(rep_user_id, status) WHERE rep_user_id IS NOT NULL;

CREATE TABLE client_order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES client_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  qty_delivered NUMERIC(12,3) NOT NULL DEFAULT 0
);
CREATE INDEX client_order_items_order_idx ON client_order_items(order_id);

CREATE TABLE debt_ledger (
  id UUID PRIMARY KEY,
  supplier_org_id UUID NOT NULL,
  client_user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delivery_charge','payment','return_credit')),
  amount_minor BIGINT NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id UUID,
  note TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX debt_ledger_pair_idx ON debt_ledger(supplier_org_id, client_user_id, created_at DESC);

CREATE TABLE client_order_status_history (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES client_orders(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
