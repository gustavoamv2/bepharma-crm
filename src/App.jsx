import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { LayoutDashboard, Briefcase, Building2, Users, Search, LogOut, Settings, Kanban, BarChart2, KeyRound, HelpCircle, Mail } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './hooks/useToast'
import { hubspot } from './hooks/useApi'
import Dashboard from './pages/Dashboard'
import DealList from './pages/DealList'
import DealDetail from './pages/DealDetail'
import CompanyList from './pages/CompanyList'
import CompanyDetail from './pages/CompanyDetail'
import ContactList from './pages/ContactList'
import ContactDetail from './pages/ContactDetail'
import SearchPage from './pages/SearchPage'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AdminPage from './pages/AdminPage'
import KanbanPage from './pages/KanbanPage'
import ReportsPage from './pages/ReportsPage'
import HelpPage from './pages/HelpPage'
import MailboxPage from './pages/MailboxPage'
import GlobalSearch from './components/GlobalSearch'
import ChangePasswordModal from './components/ChangePasswordModal'

function Avatar({ name }) {
  const initials = (name || 'U').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{
      width: 30, height: 30, borderRadius: '50%', background: '#4fc3f7',
      color: '#0a1929', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 800, flexShrink: 0
    }}>{initials}</div>
  )
}

// Polling de notificaciones (tareas pendientes) cada 2 minutos
function useNotifCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    const fetch = async () => {
      try {
        const data = await hubspot.getNotifications()
        if (alive) setCount(data.count || 0)
      } catch { /* ignore */ }
    }
    fetch()
    const interval = setInterval(fetch, 2 * 60 * 1000)
    return () => { alive = false; clearInterval(interval) }
  }, [])
  return count
}

function AppContent() {
  const { user, logout, loading } = useAuth()
  const notifCount = useNotifCount()
  const [showChangePassword, setShowChangePassword] = useState(false)

  // Vista de operador reactiva â€” se sincroniza con el toggle del Dashboard
  const [viewMode, setViewMode] = useState(
    () => sessionStorage.getItem('bp_view_mode') || ''
  )
  useEffect(() => {
    const handler = () => setViewMode(sessionStorage.getItem('bp_view_mode') || '')
    window.addEventListener('bpViewModeChange', handler)
    return () => window.removeEventListener('bpViewModeChange', handler)
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a1929' }}>
        <div style={{ color: '#4fc3f7', fontSize: 14 }}>Cargando...</div>
      </div>
    )
  }

  if (!user) {
    // Rutas publicas (sin sesion): login + recuperar/restablecer contraseña.
    // Cualquier otra ruta cae en LoginPage.
    return (
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="*"                element={<LoginPage />} />
      </Routes>
    )
  }

  // Supervisor actuando como operador â†’ menú de operador
  // (si canToggleView es false, el usuario nunca puede pasar a vista operador)
  const isSupervisor = user.role === 'supervisor' && (viewMode !== 'operator' || user.canToggleView === false)

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="BePharma" style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
          Be<span>Pharma</span> CRM
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section">Principal</div>
          <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
            <LayoutDashboard size={15} />
            {isSupervisor ? 'Dashboard equipo' : 'Mis pendientes'}
            {notifCount > 0 && (
              <span className="notif-badge">{notifCount > 9 ? '9+' : notifCount}</span>
            )}
          </NavLink>

          <div className="sidebar-section">CRM</div>
          <NavLink to="/deals" className={({ isActive }) => isActive ? 'active' : ''}>
            <Briefcase size={15} />
            {isSupervisor ? 'Todos los eventos' : 'Mis eventos'}
          </NavLink>
          <NavLink to="/companies" className={({ isActive }) => isActive ? 'active' : ''}>
            <Building2 size={15} />
            {isSupervisor ? 'Empresas' : 'Mis empresas'}
          </NavLink>
          <NavLink to="/kanban" className={({ isActive }) => isActive ? 'active' : ''}>
            <Kanban size={15} /> Pipeline de Eventos
          </NavLink>
          <NavLink to="/contacts" className={({ isActive }) => isActive ? 'active' : ''}>
            <Users size={15} />
            {isSupervisor ? 'Contactos' : 'Mis contactos'}
          </NavLink>
          <NavLink to="/mailbox" className={({ isActive }) => isActive ? 'active' : ''}>
            <Mail size={15} /> Buzon
          </NavLink>

          <div className="sidebar-section">Herramientas</div>
          <NavLink to="/search" className={({ isActive }) => isActive ? 'active' : ''}>
            <Search size={15} /> Buscar contactos
          </NavLink>
          <NavLink to="/ayuda" className={({ isActive }) => isActive ? 'active' : ''}>
            <HelpCircle size={15} /> Ayuda / Guía de uso
          </NavLink>

          {isSupervisor && (
            <>
              <div className="sidebar-section">Supervisor</div>
              <NavLink to="/reports" className={({ isActive }) => isActive ? 'active' : ''}>
                <BarChart2 size={15} /> Reportes
              </NavLink>
              <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>
                <Settings size={15} /> Administración
              </NavLink>
            </>
          )}
        </nav>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #1a2d42', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name={user.name} />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#e0f7fa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.name}
            </div>
            <div style={{ fontSize: 10, color: '#546e7a' }}>
              {user.role === 'supervisor'
                ? (!isSupervisor ? 'Vista operador' : 'Supervisor')
                : 'Operador'}
            </div>
          </div>
          <button onClick={() => setShowChangePassword(true)} title="Cambiar contraseña"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#546e7a', padding: 4, borderRadius: 4 }}>
            <KeyRound size={15} />
          </button>
          <button onClick={logout} title="Cerrar sesión"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#546e7a', padding: 4, borderRadius: 4 }}>
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}

      <div className="main">
        <Routes>
          <Route path="/"              element={<Dashboard />} />
          <Route path="/deals"         element={<DealList />} />
          <Route path="/deals/:id"     element={<DealDetail />} />
          <Route path="/companies"     element={<CompanyList />} />
          <Route path="/companies/:id" element={<CompanyDetail />} />
          <Route path="/kanban"        element={<KanbanPage />} />
          <Route path="/contacts"      element={<ContactList />} />
          <Route path="/contacts/:id"  element={<ContactDetail />} />
          <Route path="/mailbox"      element={<MailboxPage />} />
          <Route path="/search"        element={<SearchPage />} />
          <Route path="/ayuda"         element={<HelpPage />} />
          <Route path="/reports"       element={<ReportsPage />} />
          <Route path="/admin"         element={<AdminPage />} />
          <Route path="*"             element={<Dashboard />} />
        </Routes>

        {/* GlobalSearch: singleton, activado con Ctrl+K */}
        <GlobalSearch />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

