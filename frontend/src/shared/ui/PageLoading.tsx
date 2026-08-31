export function PageLoading({ label = 'Загрузка' }: { label?: string }) {
  return (
    <div className="page page-loading" aria-busy="true" aria-live="polite">
      <div className="stack page-loading__skeleton">
        <div className="skeleton skeleton-line" style={{ width: '42%' }} />
        <div className="skeleton skeleton-card" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}
