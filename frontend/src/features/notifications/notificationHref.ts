export function notificationHref(n: { entity_type?: string | null; entity_id?: string | null }) {
  const type = String(n.entity_type ?? '')
  const id = n.entity_id
  if (type === 'appointment' && id) return `/appointments/${id}`
  if (type === 'conversation' && id) return `/messages/${id}`
  if (type === 'masterclass' && id) return `/masterclasses/${id}`
  if (type === 'model_request' && id) return `/models/${id}`
  if (type === 'client_order' && id) return `/orders/${id}`
  if (type === 'hair_consultation' && id) return `/consultations/${id}`
  return '/notifications'
}
