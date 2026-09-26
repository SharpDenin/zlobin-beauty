export type ProfessionType = {
  id: string
  slug: string
  name: string
  is_active?: boolean
  locked_at?: string | null
}

export type MasterProfessionFields = {
  profession_types?: ProfessionType[]
  specializations?: string[]
}

export function masterProfessionLabel(master: MasterProfessionFields, empty = 'Профессиональный тип не указан'): string {
  const names = (master.profession_types ?? []).map((t) => t.name).filter(Boolean)
  if (names.length > 0) return names.join(', ')
  const specs = (master.specializations ?? []).map((s) => s.trim()).filter(Boolean)
  if (specs.length > 0) return specs.join(', ')
  return empty
}

export function selectedProfessionIds(master: MasterProfessionFields | null | undefined): string[] {
  return (master?.profession_types ?? []).map((t) => t.id).filter(Boolean)
}
