import { AppIcon, type AppIconName } from '@/shared/ui/AppIcon'

function iconFor(to: string): AppIconName {
  if (to === '/more') return 'more'
  if (to === '/' || to === '/supplier' || to === '/rep' || to === '/admin') return 'home'
  if (to.startsWith('/admin/users')) return 'user'
  if (to.startsWith('/admin/organizations') || to.startsWith('/admin/suppliers')) return 'warehouse'
  if (to.startsWith('/admin/masters') || to.startsWith('/admin/services')) return 'scissors'
  if (to.startsWith('/admin/products')) return 'bag'
  if (to.startsWith('/admin/knowledge') || to.startsWith('/admin/catalogs')) return 'book'
  if (to.startsWith('/admin/appointments')) return 'calendar'
  if (to.startsWith('/admin/orders')) return 'money'
  if (to.startsWith('/admin/disputes')) return 'chat'
  if (to.startsWith('/admin/audit')) return 'clipboard'
  if (to.includes('panel=schedule') || to.startsWith('/schedule')) return 'schedule'
  if (to.startsWith('/calendar')) return 'calendar'
  if (to.startsWith('/appointments')) return 'clock'
  if (to.startsWith('/search')) return 'search'
  if (to.startsWith('/shop')) return 'bag'
  if (to.startsWith('/cosmetics')) return 'bottle'
  if (to.startsWith('/knowledge')) return 'book'
  if (to.startsWith('/messages')) return 'chat'
  if (to.startsWith('/contacts')) return 'contacts'
  if (to.startsWith('/portfolio')) return 'portfolio'
  if (to.startsWith('/settings')) return 'settings'
  if (to.startsWith('/salon/settings')) return 'settings'
  if (to.startsWith('/subscription')) return 'crown'
  if (to.startsWith('/profile')) return 'user'
  if (to.startsWith('/staff/invite')) return 'qr'
  if (to.startsWith('/staff')) return 'staff'
  if (to.startsWith('/clients')) return 'contacts'
  if (to.startsWith('/reports') || to.startsWith('/supplier/analytics') || to.startsWith('/rep/analytics')) return 'reports'
  if (to.startsWith('/services')) return 'scissors'
  if (to.startsWith('/supplier/products')) return 'box'
  if (to.startsWith('/supplier/orders') || to.startsWith('/supplier/client-orders')) return 'money'
  if (to.startsWith('/inventory')) return 'warehouse'
  if (to.startsWith('/warehouse')) return 'warehouse'
  if (to.startsWith('/rep/finance')) return 'money'
  if (to.startsWith('/masterclasses')) return 'book'
  if (to.startsWith('/models')) return 'portfolio'
  if (to.startsWith('/consultations')) return 'scissors'
  return 'home'
}

export function NavIcon({ to }: { to: string }) {
  return <AppIcon name={iconFor(to)} className="nav-icon" size={22} />
}

export { iconFor as navIconNameFor }
