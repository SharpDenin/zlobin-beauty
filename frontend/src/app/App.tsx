import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { AppShell, RequireAuth, RequireMaster } from '@/app/layout'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { HomePage } from '@/pages/HomePage'
import { SearchPage } from '@/pages/SearchPage'
import { MasterPage } from '@/pages/MasterPage'
import { AppointmentsPage } from '@/pages/AppointmentsPage'
import { MasterCabinetPage } from '@/pages/MasterCabinetPage'
import { AppointmentDetailPage } from '@/pages/AppointmentDetailPage'
import { ClientCardPage } from '@/pages/ClientCardPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import type { ReactNode } from 'react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1 },
  },
})

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="state-box page">Загрузка…</div>
  if (user) return <Navigate to="/" replace />
  return children
}

function LoginRoute() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return (
    <PublicOnly>
      <LoginPage redirectTo={from && from !== '/login' ? from : '/'} />
    </PublicOnly>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
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
                <Route element={<RequireMaster />}>
                  <Route path="/master" element={<MasterCabinetPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
