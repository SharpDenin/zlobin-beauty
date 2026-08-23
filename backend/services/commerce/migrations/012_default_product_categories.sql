-- Demo catalog categories for Knowledge Hub product-category relations.
INSERT INTO product_categories (id, name, slug, created_at) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Краска', 'kraska', now()),
  ('a1000000-0000-4000-8000-000000000002', 'Окислитель', 'okislitel', now()),
  ('a1000000-0000-4000-8000-000000000003', 'Шампунь', 'shampun', now()),
  ('a1000000-0000-4000-8000-000000000004', 'Уход', 'uhod', now()),
  ('a1000000-0000-4000-8000-000000000005', 'Маска', 'maska', now()),
  ('a1000000-0000-4000-8000-000000000006', 'Стайлинг', 'stajling', now())
ON CONFLICT (name) DO NOTHING;
