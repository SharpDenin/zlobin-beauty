import { apiRequest } from '@/shared/api/client'
import type {
  AdminAppointment,
  AdminArticle,
  AdminAudit,
  AdminDispute,
  AdminMaster,
  AdminOrder,
  AdminOrg,
  AdminProduct,
  AdminService,
  AdminUser,
  Page,
} from './types'

type Token = string | null | undefined

export function adminList(path: string, token: Token, params: URLSearchParams) {
  const q = params.toString()
  return apiRequest<Page<Record<string, unknown>>>(`${path}${q ? `?${q}` : ''}`, { token })
}

export const adminApi = {
  userStats: (token: Token) => apiRequest<{ users_total: number; users_active: number; users_blocked: number }>('/v1/admin/stats', { token }),
  orgStats: (token: Token) => apiRequest<{ organizations_total: number; organizations_active: number; salons: number; suppliers: number }>('/v1/admin/organizations/stats', { token }),
  marketplaceStats: (token: Token) =>
    apiRequest<{ masters_total: number; masters_published: number; articles_published: number; articles_draft: number; services_total: number }>(
      '/v1/admin/masters/stats',
      { token },
    ),
  commerceStats: (token: Token) => apiRequest<{ products_total: number; products_published: number; orders_total: number }>('/v1/admin/products/stats', { token }),
  appointmentStats: (token: Token) => apiRequest<{ appointments_total: number }>('/v1/admin/appointments/stats', { token }),
  disputeStats: (token: Token) => apiRequest<{ disputes_open: number; disputes_total: number }>('/v1/admin/disputes/stats', { token }),

  users: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminUser>>(`/v1/admin/users?${params}`, { token }),
  user: (token: Token, id: string) => apiRequest<AdminUser>(`/v1/admin/users/${id}`, { token }),
  blockUser: (token: Token, id: string, reason: string) =>
    apiRequest<AdminUser>(`/v1/admin/users/${id}/block`, { token, method: 'POST', body: { reason } }),
  unblockUser: (token: Token, id: string) => apiRequest<AdminUser>(`/v1/admin/users/${id}/unblock`, { token, method: 'POST', body: {} }),

  orgs: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminOrg>>(`/v1/admin/organizations?${params}`, { token }),
  org: (token: Token, id: string) => apiRequest<AdminOrg>(`/v1/admin/organizations/${id}`, { token }),
  setOrgPublished: (token: Token, id: string, published: boolean) =>
    apiRequest<AdminOrg>(`/v1/admin/organizations/${id}/${published ? 'publish' : 'unpublish'}`, { token, method: 'POST', body: {} }),

  masters: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminMaster>>(`/v1/admin/masters?${params}`, { token }),
  master: (token: Token, id: string) => apiRequest<AdminMaster>(`/v1/admin/masters/${id}`, { token }),
  setMasterPublished: (token: Token, id: string, published: boolean) =>
    apiRequest<AdminMaster>(`/v1/admin/masters/${id}/${published ? 'publish' : 'unpublish'}`, { token, method: 'POST', body: {} }),
  workingHours: (token: Token, masterUserId: string) =>
    apiRequest<{ items: { weekday: number; start_minute: number; end_minute: number }[] }>(`/v1/admin/working-hours?master_user_id=${masterUserId}`, { token }),

  services: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminService>>(`/v1/admin/services?${params}`, { token }),
  service: (token: Token, id: string) => apiRequest<AdminService>(`/v1/admin/services/${id}`, { token }),
  setServicePublished: (token: Token, id: string, published: boolean) =>
    apiRequest<AdminService>(`/v1/admin/services/${id}/${published ? 'publish' : 'unpublish'}`, { token, method: 'POST', body: {} }),

  products: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminProduct>>(`/v1/admin/products?${params}`, { token }),
  product: (token: Token, id: string) => apiRequest<AdminProduct>(`/v1/admin/products/${id}`, { token }),
  setProductPublished: (token: Token, id: string, published: boolean) =>
    apiRequest<AdminProduct>(`/v1/admin/products/${id}/${published ? 'publish' : 'unpublish'}`, { token, method: 'POST', body: {} }),

  knowledge: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminArticle>>(`/v1/admin/knowledge?${params}`, { token }),
  article: (token: Token, id: string) => apiRequest<AdminArticle>(`/v1/admin/knowledge/${id}`, { token }),
  setArticleStatus: (token: Token, id: string, action: 'publish' | 'unpublish' | 'archive') =>
    apiRequest<AdminArticle>(`/v1/admin/knowledge/${id}/${action}`, { token, method: 'POST', body: {} }),

  appointments: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminAppointment>>(`/v1/admin/appointments?${params}`, { token }),
  appointment: (token: Token, id: string) => apiRequest<AdminAppointment>(`/v1/admin/appointments/${id}`, { token }),

  orders: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminOrder>>(`/v1/admin/orders?${params}`, { token }),
  order: (token: Token, id: string) => apiRequest<AdminOrder>(`/v1/admin/orders/${id}`, { token }),

  disputes: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminDispute>>(`/v1/admin/disputes?${params}`, { token }),
  dispute: (token: Token, id: string) => apiRequest<AdminDispute>(`/v1/admin/disputes/${id}`, { token }),
  resolveDispute: (token: Token, id: string, status: 'resolved' | 'rejected', reason: string) =>
    apiRequest<AdminDispute>(`/v1/admin/disputes/${id}/resolve`, { token, method: 'POST', body: { status, reason } }),

  audit: (token: Token, params: URLSearchParams) => apiRequest<Page<AdminAudit>>(`/v1/admin/audit-log?${params}`, { token }),
}
