const ICONS: Record<string, string> = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  calendar: 'M8 3v3M16 3v3M5 8h14M7 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm1 8h3v3H8z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm6.5.5L21 21',
  bag: 'M6 8h12l-1.1 12.2A2 2 0 0 1 14.9 22H9.1a2 2 0 0 1-2-1.8L6 8zm3 0V6a3 3 0 0 1 6 0v2',
  user: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7.5 9a7.5 7.5 0 0 1 15 0',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  box: 'M4 8h16v11H4zm0 0 8-4 8 4M12 8v11',
  warehouse: 'M3 20V9l9-5 9 5v11H3zm5-4h8',
  money: 'M4 8h16v10H4zm4 5h8M8 8V6h8v2',
  chat: 'M5 6h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-6l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  doc: 'M7 3h8l4 4v14H7zM15 3v4h4M9 12h6M9 16h6',
  book: 'M5 4h9a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2V4zm0 0v16M16 6h3a1 1 0 0 1 1 1v13H9',
  contacts: 'M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm10-4h-4M18 10h-4M4 20v-1a4 4 0 0 1 8 0v1M14 14h6v6h-6z',
  portfolio: 'M4 8h16v11H4zm5-3h6l1 3H8zM8 13h8',
  scissors: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 9.5 20 20M6.5 20.5 14 14',
  staff: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a5 5 0 0 1 10 0M13 20a5 5 0 0 1 8 0',
  schedule: 'M5 8h14M8 3v3M16 3v3M7 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 7h2m3 0h4m-9 4h8',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM4.5 11l2-1.5L6.5 6 9 6.5 10.7 5.5 11 3h2l.3 2.5 1.7 1L17.5 6l2 3.5-2 1.5a8 8 0 0 1 0 2l2 1.5-2 3.5-2.5-.5-1.7 1L13 21h-2l-.3-2.5-1.7-1L6.5 18l-2-3.5 2-1.5A8 8 0 0 1 4.5 11z',
  reports: 'M5 19V9m7 10V5m7 14v-7',
  bottle: 'M9 3h6M10 3v3L7 12v7a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-7l-3-6V3M9 14h6',
  clipboard: 'M9 4h6a1 1 0 0 1 1 1v1h2v14H6V6h2V5a1 1 0 0 1 1-1zm0 2h6M9 12h6M9 16h4',
  qr: 'M4 4h7v7H4zm2 2v3h3V6zm7-2h7v7h-7zm2 2v3h3V6zM4 13h7v7H4zm2 2v3h3v-3zm9 0h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm2 2h4v2h-2v-2h-2zm2-4h2v2h-2z',
  crown: 'M4 17h16l-1.5-9-3.5 3L12 6l-3 5-3.5-3L4 17zm2 2h12',
}

function iconFor(to: string) {
  if (to === '/more') return 'more'
  if (to === '/' || to === '/supplier' || to === '/rep' || to === '/admin') return 'home'
  if (to.startsWith('/admin/users')) return 'user'
  if (to.startsWith('/admin/organizations') || to.startsWith('/admin/suppliers')) return 'warehouse'
  if (to.startsWith('/admin/masters') || to.startsWith('/admin/services')) return 'scissors'
  if (to.startsWith('/admin/products')) return 'bag'
  if (to.startsWith('/admin/knowledge') || to.startsWith('/admin/catalogs')) return 'search'
  if (to.startsWith('/admin/appointments')) return 'calendar'
  if (to.startsWith('/admin/orders')) return 'money'
  if (to.startsWith('/admin/disputes')) return 'chat'
  if (to.startsWith('/admin/audit')) return 'clipboard'
  if (to.startsWith('/calendar')) return 'calendar'
  if (to.startsWith('/schedule')) return 'schedule'
  if (to.startsWith('/appointments')) return 'clock'
  if (to.startsWith('/search')) return 'search'
  if (to.startsWith('/shop')) return 'bag'
  if (to.startsWith('/cosmetics')) return 'bottle'
  if (to.startsWith('/knowledge')) return 'book'
  if (to.startsWith('/messages')) return 'chat'
  if (to.startsWith('/contacts')) return 'contacts'
  if (to.startsWith('/portfolio')) return 'portfolio'
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
  return 'home'
}

export function NavIcon({ to }: { to: string }) {
  const key = iconFor(to)
  const d = ICONS[key]
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}
