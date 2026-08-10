-- Catalog polish: sale flag, delivery hint, product image.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS for_sale BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS delivery_days INT NOT NULL DEFAULT 3 CHECK (delivery_days >= 0),
    ADD COLUMN IF NOT EXISTS photo_media_id UUID;

CREATE INDEX IF NOT EXISTS products_for_sale_idx ON products(organization_id, for_sale) WHERE for_sale AND published;
