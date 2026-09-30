import type { CabinetKind } from '@/shared/lib/cabinet'

/** Role-appropriate dashboard subtitle — never uses the word «Кабинет». */
export function roleTitle(kind: CabinetKind): string {
  switch (kind) {
    case 'salon_owner':
      return 'Владелец салона'
    case 'private_master':
      return 'Частный мастер'
    case 'salon_employee':
      return 'Мастер салона'
    case 'chair_master':
      return 'Арендатор кресла'
    case 'mobile_master':
      return 'Выездной мастер'
    case 'salon_admin':
      return 'Администратор салона'
    case 'chain_owner':
      return 'Владелец сети'
    case 'supplier':
      return 'Поставщик'
    case 'supplier_rep':
      return 'Представитель поставщика'
    case 'platform_admin':
      return 'Администратор платформы'
    default:
      return 'Salon-X'
  }
}
