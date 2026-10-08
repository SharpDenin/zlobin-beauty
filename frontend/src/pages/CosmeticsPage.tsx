import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchSuppliers, useBuyerOrg } from '@/shared/lib/commerce'
import { Hint } from '@/shared/ui/Hint'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'

function productCountLabel(count: number) {
  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (count === 0) return 'Каталог пока пуст'
  if (n > 10 && n < 20) return `${count} товаров`
  if (n1 === 1) return `${count} товар`
  if (n1 >= 2 && n1 <= 4) return `${count} товара`
  return `${count} товаров`
}

export function CosmeticsPage() {
  const { accessToken } = useAuth()
  const { buyerOrg, buyerOrgId, orgs } = useBuyerOrg()

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => fetchSuppliers(accessToken),
    enabled: Boolean(accessToken),
  })

  if (orgs.isLoading) {
    return <main className="page"><div className="skeleton skeleton-card" aria-busy="true" /></main>
  }

  if (!buyerOrgId) {
    return (
      <main className="page stack">
        <EmptyState
          title="Нужен салон"
          text="Создайте салон на странице мастера, чтобы заказывать косметику."
          action={<Link className="btn btn-primary" to="/master">Моя страница</Link>}
        />
      </main>
    )
  }

  const items = suppliers.data ?? []

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Косметика <Hint id="cosmetics-order" title="Заказ косметики">Карточки поставщиков ведут в каталог. Самовывоз — в филиал салона.</Hint></h1>
          <p className="muted">Поставщики для салона «{buyerOrg?.organization.name}»</p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary btn-compact" to="/cosmetics/recurring">Регулярные поставки</Link>
          <Link className="btn btn-secondary btn-compact" to="/cosmetics/orders">Мои заказы</Link>
        </div>
      </div>

      {suppliers.isLoading && <div className="skeleton skeleton-card" aria-busy="true" />}
      {suppliers.isError && <ErrorBanner error={suppliers.error} fallbackTitle="Не удалось загрузить поставщиков" />}
      {!suppliers.isLoading && !suppliers.isError && items.length === 0 && (
        <EmptyState
          title="Поставщиков пока нет"
          text="Каталог появится, когда поставщики опубликуют профили."
          action={<Link className="btn btn-secondary" to="/cosmetics/orders">Открыть заказы</Link>}
        />
      )}

      <div className="cards-grid">
        {items.map((s) => {
          const count = s.product_count ?? s.products_count
          const hint = s.product_hint
            || (typeof count === 'number' ? productCountLabel(count) : s.description)
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
