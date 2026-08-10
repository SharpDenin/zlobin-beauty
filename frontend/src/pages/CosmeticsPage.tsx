import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchSuppliers, useBuyerOrg } from '@/shared/lib/commerce'

export function CosmeticsPage() {
  const { accessToken } = useAuth()
  const { buyerOrg, buyerOrgId, orgs } = useBuyerOrg()

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => fetchSuppliers(accessToken),
    enabled: Boolean(accessToken),
  })

  if (orgs.isLoading) {
    return <main className="page"><div className="state-box">Загрузка…</div></main>
  }

  if (!buyerOrgId) {
    return (
      <main className="page stack">
        <div className="empty-state">
          <h2>Нужен салон</h2>
          <p>Создайте салон в кабинете мастера, чтобы заказывать косметику.</p>
          <Link className="btn btn-primary" to="/master">Открыть кабинет</Link>
        </div>
      </main>
    )
  }

  const items = suppliers.data ?? []

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Косметика</h1>
          <p className="muted">Поставщики для салона «{buyerOrg?.organization.name}»</p>
        </div>
        <Link className="btn btn-secondary btn-compact" to="/cosmetics/orders">Мои заказы</Link>
      </div>

      {suppliers.isLoading && <div className="state-box">Загрузка поставщиков…</div>}
      {suppliers.isError && (
        <div className="state-box error">Не удалось загрузить поставщиков. Попробуйте позже.</div>
      )}
      {!suppliers.isLoading && !suppliers.isError && items.length === 0 && (
        <div className="empty-state">
          <h2>Поставщиков пока нет</h2>
          <p>Каталог появится, когда поставщики опубликуют профили.</p>
          <Link className="btn btn-secondary" to="/cosmetics/orders">Открыть заказы</Link>
        </div>
      )}

      <div className="cards-grid">
        {items.map((s) => {
          const count = s.product_count ?? s.products_count
          const hint = s.product_hint
            || (typeof count === 'number' ? `${count} товар(ов)` : s.description)
            || 'Каталог профессиональной косметики'
          return (
            <Link key={s.id} to={`/cosmetics/${s.id}`} className="supplier-card">
              <div className="row between">
                <strong>{s.name}</strong>
                {s.city && <span className="chip badge-default">{s.city}</span>}
              </div>
              <p>{hint}</p>
              {s.delivery_note && <p className="muted">Доставка: {s.delivery_note}</p>}
              <span className="btn btn-secondary btn-compact">Смотреть товары</span>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
