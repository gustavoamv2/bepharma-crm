import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { LayoutDashboard, Briefcase, Building2, Users, Search, LogOut, Settings, Kanban, BarChart2 } from 'lucide-react'
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
import AdminPage from './pages/AdminPage'
import KanbanPage from './pages/KanbanPage'
import ReportsPage from './pages/ReportsPage'
import GlobalSearch from './components/GlobalSearch'

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

  // Disparar GlobalSearch con Ctrl+K desde el sidebar button
  const openSearch = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a1929' }}>
        <div style={{ color: '#4fc3f7', fontSize: 14 }}>Cargando…</div>
      </div>
    )
  }

  if (!user) return <LoginPage />

  const isSupervisor = user.role === 'supervisor'

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">Be<span>Pharma</span> CRM</div>
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
            <Kanban size={15} /> Pipeline Kanban
          </NavLink>
          <NavLink to="/contacts" className={({ isActive }) => isActive ? 'active' : ''}>
            <Users size={15} />
            {isSupervisor ? 'Contactos' : 'Mis contactos'}
          </NavLink>

          <div className="sidebar-section">Herramientas</div>
          <NavLink to="/search" className={({ isActive }) => isActive ? 'active' : ''}>
            <Search size={15} /> Buscar contactos
          </NavLink>
          <div
            role="button"
            tabIndex={0}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
              color: '#b0bec5', fontSize: 13, cursor: 'pointer', transition: 'background .15s',
            }}
            onClick={openSearch}
            onKeyDown={e => e.key === 'Enter' && openSearch()}
          >
            <Search size={15} /> Búsqueda global
            <span style={{ marginLeft: 'auto', fontSize: 10, background: '#1a2d42', padding: '1px 6px', borderRadius: 4, color: '#78909c' }}>
              Ctrl+K
            </span>
          </div>

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
                ? (sessionStorage.getItem('bp_view_mode') === 'operator' ? '👁 Vista operador' : '⭐ Supervisor')
                : '👤 Operador'}
            </div>
          </div>
          <button onClick={logout} title="Cerrar sesión"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#546e7a', padding: 4, borderRadius: 4 }}>
            <LogOut size={15} />
          </button>
        </div>
      </aside>

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
          <Route path="/search"        element={<SearchPage />} />
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
