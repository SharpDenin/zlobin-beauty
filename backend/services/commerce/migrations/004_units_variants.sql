-- units of measure + product volume variants (parent_id groups siblings)
CREATE TABLE IF NOT EXISTS units_of_measure (
    id UUID PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO units_of_measure (id, code, name, created_at) VALUES
    ('a0000001-0000-4000-8000-000000000001', 'pcs', 'шт', now()),
    ('a0000001-0000-4000-8000-000000000002', 'ml', 'мл', now()),
    ('a0000001-0000-4000-8000-000000000003', 'l', 'л', now()),
    ('a0000001-0000-4000-8000-000000000004', 'g', 'г', now()),
    ('a0000001-0000-4000-8000-000000000005', 'kg', 'кг', now())
ON CONFLICT (code) DO NOTHING;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_parent_idx ON products(parent_id) WHERE parent_id IS NOT NULL;
