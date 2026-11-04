import type { ReactNode, SVGProps } from 'react'

/** Shared stroke icon set for navigation and critical controls (Lucide-compatible outlines). */
export type AppIconName =
  | 'home'
  | 'calendar'
  | 'clock'
  | 'search'
  | 'bag'
  | 'user'
  | 'more'
  | 'box'
  | 'warehouse'
  | 'money'
  | 'chat'
  | 'doc'
  | 'book'
  | 'contacts'
  | 'portfolio'
  | 'scissors'
  | 'staff'
  | 'schedule'
  | 'settings'
  | 'reports'
  | 'bottle'
  | 'clipboard'
  | 'qr'
  | 'crown'
  | 'x'
  | 'clients'
  | 'services'
  | 'bell'
  | 'attach'
  | 'send'

const ICONS: Record<AppIconName, ReactNode> = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 10.5V20a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <path d="M8 14h3v3H8z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8h12l-1.1 12.2A2 2 0 0 1 14.9 22H9.1a2 2 0 0 1-2-1.8L6 8z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  box: (
    <>
      <path d="M4 8h16v11H4z" />
      <path d="m4 8 8-4 8 4M12 8v11" />
    </>
  ),
  warehouse: (
    <>
      <path d="M3 20V9l9-5 9 5v11H3z" />
      <path d="M8 16h8" />
    </>
  ),
  money: (
    <>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M8 13h8M8 7V5h8v2" />
    </>
  ),
  chat: (
    <>
      <path d="M5 6h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-6l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3h8l4 4v14H7z" />
      <path d="M15 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  book: (
    <>
      <path d="M5 4h9a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2V4z" />
      <path d="M16 6h3a1 1 0 0 1 1 1v13H9" />
    </>
  ),
  contacts: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M2 20v-1a4 4 0 0 1 8 0v1" />
      <path d="M14 6h6M14 10h6M14 14h6v6h-6z" />
    </>
  ),
  portfolio: (
    <>
      <path d="M4 8h16v11H4z" />
      <path d="M9 5h6l1 3H8zM8 13h8" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="m20 4-8.5 8.5M20 20l-8.5-8.5" />
    </>
  ),
  staff: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M2 20a5 5 0 0 1 10 0M12 20a5 5 0 0 1 10 0" />
    </>
  ),
  schedule: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M4 11h16M8 15h2m3 0h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 17.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 6.1l1.6-1.6" />
    </>
  ),
  reports: (
    <>
      <path d="M5 19V9M12 19V5M19 19v-7" />
    </>
  ),
  bottle: (
    <>
      <path d="M9 3h6M10 3v3L7 12v7a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-7l-3-6V3" />
      <path d="M9 14h6" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 12h6M9 16h4" />
    </>
  ),
  qr: (
    <>
      <path d="M4 4h7v7H4zM6 6v3h3V6M13 4h7v7h-7M15 6v3h3V6M4 13h7v7H4M6 15v3h3v-3" />
      <path d="M15 15h2v2h-2M19 15h2v2h-2M15 19h2v2h-2M17 17h4v4h-2v-2h-2z" />
    </>
  ),
  crown: (
    <>
      <path d="M4 17h16l-1.5-9-3.5 3L12 6l-3 5-3.5-3L4 17z" />
      <path d="M6 19h12" />
    </>
  ),
  x: (
    <>
      <path d="M7 7l10 10M17 7 7 17" />
    </>
  ),
  clients: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  services: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="m20 4-8.5 8.5M20 20l-8.5-8.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  ),
  attach: (
    <>
      <path d="m15.5 7.5-6.8 6.8a2.5 2.5 0 0 0 3.5 3.5l7.2-7.2a4 4 0 0 0-5.7-5.7L6.5 12.1" />
    </>
  ),
  send: (
    <>
      <path d="M5 12h12" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
}

type AppIconProps = {
  name: AppIconName
  size?: number
  className?: string
  title?: string
} & Omit<SVGProps<SVGSVGElement>, 'children' | 'name'>

export function AppIcon({ name, size = 22, className, title, ...rest }: AppIconProps) {
  const body = ICONS[name]
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  )
}
