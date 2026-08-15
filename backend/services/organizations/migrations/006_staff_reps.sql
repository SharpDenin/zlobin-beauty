-- Staff management, supplier representatives, contact privacy, audit.

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS masters_see_client_contacts BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS org_audit_events (
    id UUID PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_audit_events_org_idx
    ON org_audit_events(organization_id, created_at DESC);

CREATE TABLE supplier_representatives (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    territory TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX supplier_representatives_org_idx ON supplier_representatives(organization_id, active);
CREATE INDEX supplier_representatives_user_idx ON supplier_representatives(user_id);
CREATE INDEX supplier_representatives_city_idx ON supplier_representatives(organization_id, city);

CREATE TABLE representative_salon_assignments (
    representative_id UUID NOT NULL REFERENCES supplier_representatives(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (representative_id, branch_id)
);

CREATE INDEX representative_salon_assignments_branch_idx
    ON representative_salon_assignments(branch_id);

CREATE TABLE representative_tasks (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    representative_id UUID NOT NULL REFERENCES supplier_representatives(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_at TIMESTAMPTZ,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled', 'overdue')),
    result_comment TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX representative_tasks_rep_idx ON representative_tasks(representative_id, status, due_at);
CREATE INDEX representative_tasks_org_idx ON representative_tasks(organization_id, due_at);

CREATE TABLE field_routes (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    representative_id UUID NOT NULL REFERENCES supplier_representatives(id) ON DELETE CASCADE,
    planned_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'recommended', 'active', 'completed', 'cancelled')),
    total_km NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_minutes INT NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'haversine',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX field_routes_rep_date_idx ON field_routes(representative_id, planned_date DESC);

CREATE TABLE field_route_stops (
    id UUID PRIMARY KEY,
    route_id UUID NOT NULL REFERENCES field_routes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('delivery', 'salon_visit', 'work_task')),
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    delivery_id UUID,
    task_id UUID REFERENCES representative_tasks(id) ON DELETE SET NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    deadline_at TIMESTAMPTZ,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    expected_duration_min INT NOT NULL DEFAULT 20 CHECK (expected_duration_min >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'en_route', 'arrived', 'done', 'skipped', 'failed')),
    sort_order INT NOT NULL DEFAULT 0,
    km_from_prev NUMERIC(10,2) NOT NULL DEFAULT 0,
    eta_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX field_route_stops_route_idx ON field_route_stops(route_id, sort_order);

CREATE INDEX IF NOT EXISTS branches_geo_idx
    ON branches(latitude, longitude)
    WHERE published = TRUE AND pickup_enabled = TRUE AND latitude IS NOT NULL AND longitude IS NOT NULL;
