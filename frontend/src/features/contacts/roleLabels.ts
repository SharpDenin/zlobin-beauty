const ROLE_LABELS: Record<string, string> = {
  client: 'клиент',
  master: 'мастер',
  salon_owner: 'владелец салона',
  salon_admin: 'администратор салона',
  salon_employee: 'сотрудник салона',
  employee: 'сотрудник салона',
  supplier: 'поставщик',
  supplier_rep: 'представитель поставщика',
  system_admin: 'администратор',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

export function roleLabels(roles: string[] | null | undefined): string[] {
  return (roles ?? []).map(roleLabel)
}

export function filterContactsByQuery<T extends { display_name: string; city?: string; note?: string; roles?: string[] }>(
  items: T[],
  q: string,
): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return items
  return items.filter((c) => {
    const name = c.display_name.toLowerCase()
    const city = (c.city ?? '').toLowerCase()
    const note = (c.note ?? '').toLowerCase()
    const roles = (c.roles ?? []).join(' ').toLowerCase()
    return name.includes(needle) || city.includes(needle) || note.includes(needle) || roles.includes(needle)
  })
}
