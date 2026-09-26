export type Page<T> = { items: T[]; total: number; limit: number; offset: number }

export type AdminUser = {
  id: string
  email: string | null
  display_name: string
  roles: string[]
  status: string
  created_at: string
  city?: string
  subscription?: { plan: string; status: string; trial_ends_at?: string; paid_until?: string }
}

export type AdminOrg = {
  id: string
  name: string
  description: string
  type: string
  status: string
  published: boolean
  city?: string
  logo_media_id?: string | null
  branches?: AdminBranch[]
  memberships?: { id: string; user_id: string; role: string; status: string; created_at: string }[]
}

export type AdminBranch = {
  id: string
  name: string
  city: string
  address_line: string
  published: boolean
}

export type AdminMaster = {
  id: string
  user_id: string
  organization_id: string
  display_name: string
  specializations: string[]
  city: string
  published: boolean
  photo_media_id?: string | null
  bio?: string
  work_type?: string
  services?: AdminService[]
}

export type AdminService = {
  id: string
  organization_id: string
  name: string
  category: string
  duration_minutes: number
  price_minor: number
  currency: string
  published: boolean
  photo_media_id?: string | null
  description?: string
}

export type AdminProduct = {
  id: string
  organization_id: string
  name: string
  brand: string
  category_id?: string | null
  audience: string
  price_minor: number
  currency: string
  available: number
  published: boolean
  photo_media_id?: string | null
  description?: string
}

export type AdminArticle = {
  id: string
  title: string
  status: string
  audience_kind: string
  author_name: string
  author_user_id: string
  updated_at: string
  content?: string
  content_format?: string
  product_ids?: string[]
  home_care?: boolean
  professional?: boolean
  cover_media_id?: string | null
}

export type AdminAppointment = {
  id: string
  organization_id: string
  master_user_id: string
  client_user_id: string
  service_name: string
  starts_at: string
  ends_at: string
  status: string
  price_minor: number
  currency: string
  visit_group_id?: string | null
  visit?: AdminAppointment[]
  history?: { from_status?: string; to_status: string; reason?: string; created_at: string }[]
}

export type AdminOrder = {
  id: string
  order_number?: string
  user_id: string
  supplier_org_id: string
  status: string
  total_minor: number
  currency: string
  created_at: string
  items?: { id: string; product_name: string; qty: number; price_minor: number }[]
}

export type AdminDispute = {
  id: string
  client_card_id: string
  reporter_user_id: string
  field_key: string
  comment: string
  status: string
  created_at: string
  card?: { id: string; user_id: string; organization_id: string; display_name: string }
  events?: { action: string; from_status?: string; to_status: string; created_at: string }[]
}

export type AdminAudit = {
  id: string
  actor_user_id?: string
  action: string
  entity_type: string
  entity_id?: string
  meta?: Record<string, unknown>
  created_at: string
}
