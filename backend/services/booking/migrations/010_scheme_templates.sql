-- Structured service scheme templates (category-specific field definitions).

CREATE TABLE scheme_templates (
    id UUID PRIMARY KEY,
    category_key TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    fields JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (category_key, version)
);

CREATE INDEX scheme_templates_active_idx ON scheme_templates(category_key) WHERE active = TRUE;

ALTER TABLE appointment_service_schemes
    ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES scheme_templates(id),
    ADD COLUMN IF NOT EXISTS template_version INT NOT NULL DEFAULT 1;

-- Fixed UUIDs for stable seed/demo references.
INSERT INTO scheme_templates (id, category_key, version, name, fields, active) VALUES
(
    'a1000001-0001-4000-8000-000000000001',
    'coloring',
    1,
    'Окрашивание',
    '[
      {"key":"technique","label":"Техника","type":"text","required":true},
      {"key":"dye","label":"Краситель","type":"text","required":true},
      {"key":"shades","label":"Оттенки","type":"text","required":false},
      {"key":"proportions","label":"Пропорции","type":"text","required":true},
      {"key":"oxidizer","label":"Оксид","type":"text","required":true},
      {"key":"processing_time","label":"Время выдержки","type":"text","required":false}
    ]'::jsonb,
    TRUE
),
(
    'a1000001-0001-4000-8000-000000000002',
    'haircut',
    1,
    'Стрижка',
    '[
      {"key":"technique","label":"Техника","type":"text","required":true},
      {"key":"length","label":"Длина","type":"text","required":true},
      {"key":"zones","label":"Зоны","type":"text","required":false},
      {"key":"tool","label":"Инструмент","type":"text","required":false}
    ]'::jsonb,
    TRUE
),
(
    'a1000001-0001-4000-8000-000000000003',
    'care',
    1,
    'Уход',
    '[
      {"key":"procedure","label":"Процедура","type":"text","required":true},
      {"key":"product","label":"Продукт","type":"text","required":true},
      {"key":"steps","label":"Этапы","type":"textarea","required":false},
      {"key":"exposure_time","label":"Время воздействия","type":"text","required":false}
    ]'::jsonb,
    TRUE
),
(
    'a1000001-0001-4000-8000-000000000004',
    'generic',
    1,
    'Универсальная',
    '[
      {"key":"technique","label":"Техника","type":"text","required":true},
      {"key":"products","label":"Продукты / материалы","type":"text","required":false},
      {"key":"formula","label":"Формула / состав","type":"text","required":false},
      {"key":"proportions","label":"Пропорции","type":"text","required":false}
    ]'::jsonb,
    TRUE
)
ON CONFLICT (category_key, version) DO NOTHING;
