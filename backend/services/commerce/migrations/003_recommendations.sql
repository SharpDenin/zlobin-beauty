CREATE TABLE product_recommendations (
  id UUID PRIMARY KEY,
  master_user_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  client_user_id UUID,
  comment TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (master_user_id, product_id, client_user_id)
);
CREATE UNIQUE INDEX product_reco_general_uidx ON product_recommendations(master_user_id, product_id) WHERE client_user_id IS NULL;
CREATE UNIQUE INDEX product_reco_client_uidx ON product_recommendations(master_user_id, product_id, client_user_id) WHERE client_user_id IS NOT NULL;
