type BrandLogoProps = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'brand-logo brand-logo--sm',
  md: 'brand-logo brand-logo--md',
  lg: 'brand-logo brand-logo--lg',
}

export function BrandLogo({ size = 'md', className }: BrandLogoProps) {
  return (
    <img
      src="/logo.png"
      alt="Salon-X"
      className={`${SIZE[size]}${className ? ` ${className}` : ''}`}
      width={size === 'lg' ? 96 : size === 'sm' ? 36 : 48}
      height={size === 'lg' ? 96 : size === 'sm' ? 36 : 48}
    />
  )
}
