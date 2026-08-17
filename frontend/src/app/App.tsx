import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, homePathForUser, useAuth } from '@/features/auth/AuthProvider'
import { AppShell, RequireAdmin, RequireAuth, RequireMaster, RequireSupplier } from '@/app/layout'
import { CabinetProvider } from '@/shared/lib/cabinet'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { HomePage } from '@/pages/HomePage'
import { SearchPage } from '@/pages/SearchPage'
import { MasterPage } from '@/pages/MasterPage'
import { AppointmentsPage } from '@/pages/AppointmentsPage'
import { MasterCabinetPage } from '@/pages/MasterCabinetPage'
import { AppointmentDetailPage } from '@/pages/AppointmentDetailPage'
import { ClientCardPage } from '@/pages/ClientCardPage'
import { ClientsPage } from '@/pages/ClientsPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { WarehousePage } from '@/pages/WarehousePage'
import { SupplierHomePage } from '@/pages/SupplierHomePage'
import { SupplierProductsPage } from '@/pages/SupplierProductsPage'
import { SupplierProductEditPage } from '@/pages/SupplierProductEditPage'
import { SupplierOrdersPage } from '@/pages/SupplierOrdersPage'
import { SalonReportsPage } from '@/pages/SalonReportsPage'
import { ShopPage } from '@/pages/ShopPage'
import { RepPage } from '@/pages/RepPage'
import { AdminCatalogsPage } from '@/pages/AdminCatalogsPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { CosmeticsPage } from '@/pages/CosmeticsPage'
import { CosmeticsSupplierPage } from '@/pages/CosmeticsSupplierPage'
import { CosmeticsProductPage } from '@/pages/CosmeticsProductPage'
import { CosmeticsOrdersPage } from '@/pages/CosmeticsOrdersPage'
import { ServicesPage } from '@/pages/ServicesPage'
import { KnowledgeListPage } from '@/pages/KnowledgeListPage'
import { KnowledgeArticlePage } from '@/pages/KnowledgeArticlePage'
import { SupplierAnalyticsPage } from '@/pages/SupplierAnalyticsPage'
import { SupplierTeamPage } from '@/pages/SupplierTeamPage'
import { RecurringPage } from '@/pages/RecurringPage'
import { StaffPage } from '@/pages/StaffPage'
import { SubscriptionPage } from '@/pages/SubscriptionPage'
import { ToastProvider } from '@/shared/ui/Toast'
import type { ReactNode } from 'react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1 },
  },
})

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="state-box page">Загрузка…</div>
  if (user) return <Navigate to={homePathForUser(user)} replace />
  return children
}

function LoginRoute() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return (
    <PublicOnly>
      <LoginPage redirectTo={from && from !== '/login' ? from : undefined} />
    </PublicOnly>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
        <CabinetProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/masters/:id" element={<MasterPage />} />
                <Route path="/appointments" element={<AppointmentsPage />} />
                <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
                <Route path="/clients/by-appointment/:appointmentId" element={<ClientCardPage />} />
                <Route path="/clients/:id" element={<ClientCardPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/profile/subscription" element={<SubscriptionPage />} />
                <Route path="/shop" element={<ShopPage />} />
                <Route path="/shop/cart" element={<ShopPage />} />
                <Route path="/shop/checkout" element={<ShopPage />} />
                <Route path="/shop/orders" element={<ShopPage />} />
                <Route path="/shop/:id" element={<ShopPage />} />
                <Route path="/rep" element={<RepPage />} />
                <Route path="/rep/map" element={<RepPage />} />
                <Route path="/rep/finance" element={<RepPage />} />
                <Route path="/rep/analytics" element={<RepPage />} />
                <Route path="/knowledge" element={<KnowledgeListPage />} />
                <Route path="/knowledge/:id" element={<KnowledgeArticlePage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/warehouse" element={<WarehousePage />} />
                <Route element={<RequireAdmin />}>
                  <Route path="/admin/catalogs" element={<AdminCatalogsPage />} />
                </Route>
                <Route element={<RequireMaster />}>
                  <Route path="/master" element={<MasterCabinetPage />} />
                  <Route path="/clients" element={<ClientsPage />} />
                  <Route path="/services" element={<ServicesPage />} />
                  <Route path="/services/:id" element={<ServicesPage />} />
                  <Route path="/cosmetics" element={<CosmeticsPage />} />
                  <Route path="/cosmetics/orders" element={<CosmeticsOrdersPage />} />
                  <Route path="/cosmetics/recurring" element={<RecurringPage />} />
                  <Route path="/cosmetics/products/:productId" element={<CosmeticsProductPage />} />
                  <Route path="/cosmetics/:supplierId" element={<CosmeticsSupplierPage />} />
                  <Route path="/staff" element={<StaffPage />} />
                  <Route path="/reports" element={<SalonReportsPage />} />
                </Route>
                <Route element={<RequireSupplier />}>
                  <Route path="/supplier" element={<SupplierHomePage />} />
                  <Route path="/supplier/products" element={<SupplierProductsPage />} />
                  <Route path="/supplier/products/new" element={<SupplierProductEditPage />} />
                  <Route path="/supplier/products/:id" element={<SupplierProductEditPage />} />
                  <Route path="/supplier/orders" element={<SupplierOrdersPage />} />
                  <Route path="/supplier/analytics" element={<SupplierAnalyticsPage />} />
                  <Route path="/supplier/team" element={<SupplierTeamPage />} />
                  <Route path="/supplier/recurring" element={<RecurringPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </CabinetProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
