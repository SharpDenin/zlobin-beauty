const ICONS: Record<string, string> = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  calendar: 'M7 3v3M17 3v3M4 8h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 8h3v3H8z',
  clock: 'M12 5v7l4 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm6.5.5L20 21',
  bag: 'M6 8h12l-1 12H7L6 8zm3 0V6a3 3 0 0 1 6 0v2',
  user: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 9a7 7 0 0 1 14 0',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  box: 'M4 8h16v11H4zm0 0 8-4 8 4M12 8v11',
  warehouse: 'M3 20V9l9-5 9 5v11H3zm5-4h8',
  money: 'M4 8h16v10H4zm4 5h8M8 8V6h8v2',
}

function iconFor(to: string) {
  if (to === '/more') return 'more'
  if (to === '/' || to === '/supplier' || to === '/rep') return 'home'
  if (to.startsWith('/calendar')) return 'calendar'
  if (to.startsWith('/appointments')) return 'clock'
  if (to.startsWith('/search')) return 'search'
  if (to.startsWith('/shop')) return 'bag'
  if (to.startsWith('/profile')) return 'user'
  if (to.startsWith('/supplier/products')) return 'box'
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
