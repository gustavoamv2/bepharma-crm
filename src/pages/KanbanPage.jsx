import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from 'react-query'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import RecordModal from '../components/RecordModal'
import { useAuth } from '../contexts/AuthContext'

const STAGES = [
  { key: 'nueva',           label: '🆕 Nueva',          color: '#1e88e5', bg: '#e3f2fd' },
  { key: 'depuracion',      label: '🧹 Depuración',      color: '#f57c00', bg: '#fff3e0' },
  { key: 'enriquecimiento', label: '💎 Enriquecimiento', color: '#8e24aa', bg: '#f3e5f5' },
  { key: 'calificada',      label: '✅ Calificada',      color: '#2e7d32', bg: '#e8f5e9' },
  { key: 'contactada',      label: '📞 Contactada',      color: '#00695c', bg: '#e0f2f1' },
  { key: 'seguimiento',     label: '🔁 Seguimiento',     color: '#3949ab', bg: '#e8eaf6' },
  { key: 'confirmada',      label: '🏆 Confirmada',      color: '#1b5e20', bg: '#c8e6c9' },
  { key: 'descartada',      label: '❌ Descartada',      color: '#c62828', bg: '#ffebee' },
]

const OWNER_NAMES = {
  '93615311': 'Roberto',
  '93621022': 'Yesenia',
  '93771980': 'Angel',
  '93771979': 'Gracie',
  '93771981': 'Carlos',
  '73112880': 'Sara',
}

const OWNER_COLORS = ['#4fc3f7','#81c784','#ffb74d','#f48fb1','#ce93d8','#90caf9']

function daysAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (d === 0) return 'hoy'
  if (d === 1) return 'ayer'
  return `hace ${d}d`
}

function KanbanCard({ company, onStageChange, onDelete, draggingId, setDraggingId }) {
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const p = company.properties

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div
      className={`kanban-card${draggingId === company.id ? ' dragging' : ''}`}
      draggable
      onDragStart={() => setDraggingId(company.id)}
      onDragEnd={() => setDraggingId(null)}
    >
      {/* Menu */}
      <div style={{ position: 'relative' }} ref={menuRef}>
        <button className="kc-menu-btn" onClick={() => setMenuOpen(v => !v)}>⋯</button>
        {menuOpen && (
          <div className="kc-dropdown">
            <button onClick={() => { nav(`/companies/${company.id}`); setMenuOpen(false) }}>
              🔗 Abrir detalle
            </button>
            {STAGES.map(s => (
              <button
                key={s.key}
                onClick={() => { onStageChange(company.id, s.key); setMenuOpen(false) }}
                style={{ fontSize: 11, paddingTop: 5, paddingBottom: 5 }}
              >
                {s.label}
              </button>
            ))}
            <button className="danger" onClick={() => { onDelete(company.id); setMenuOpen(false) }}>
              🗑 Eliminar
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div
        className="kc-name"
        onClick={() => nav(`/companies/${company.id}`)}
        style={{ cursor: 'pointer', paddingRight: 20 }}
      >
        {p.name || '(sin nombre)'}
      </div>
      <div className="kc-meta">
        {(p.domain || p.city) && (
          <span>{p.domain || p.city}</span>
        )}
        {p.hubspot_owner_id && OWNER_NAMES[p.hubspot_owner_id] && (
          <span style={{ color: OWNER_COLORS[Object.keys(OWNER_NAMES).indexOf(p.hubspot_owner_id) % OWNER_COLORS.length] }}>
            {OWNER_NAMES[p.hubspot_owner_id]}
          </span>
        )}
        {p.hs_lastmodifieddate && (
          <span style={{ marginLeft: 'auto' }}>{daysAgo(p.hs_lastmodifieddate)}</span>
        )}
      </div>
    </div>
  )
}

export default function KanbanPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [companies, setCompanies] = useState([]) // flat list
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createStage, setCreateStage] = useState('nueva')

  const isSupervisor = user?.role === 'supervisor'

  // Cargar empresas (pagina hasta 200)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const allCompanies = []
        let after = undefined
        for (let page = 0; page < 4; page++) {
          const res = await hubspot.searchCompanies({
            filters: [],
            sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
            limit: 50,
            after,
            properties: ['name', 'domain', 'phone', 'city', 'hubspot_owner_id', 'bp_etapa_empresa', 'hs_lastmodifieddate', 'createdate'],
          })
          allCompanies.push(...(res.results || []))
          after = res.paging?.next?.after
          if (!after) break
        }
        if (!cancelled) setCompanies(allCompanies)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Cambiar etapa (optimistic)
  const handleStageChange = useCallback(async (companyId, newStage) => {
    setCompanies(prev => prev.map(c =>
      c.id === companyId
        ? { ...c, properties: { ...c.properties, bp_etapa_empresa: newStage } }
        : c
    ))
    try {
      await hubspot.updateCompany(companyId, { bp_etapa_empresa: newStage })
    } catch (e) {
      // revert on error
      setCompanies(prev => prev.map(c =>
        c.id === companyId
          ? { ...c, properties: { ...c.properties, bp_etapa_empresa: undefined } }
          : c
      ))
    }
  }, [])

  // Eliminar
  const handleDelete = useCallback(async (companyId) => {
    if (!window.confirm('¿Eliminar esta empresa?')) return
    setCompanies(prev => prev.filter(c => c.id !== companyId))
    try {
      await hubspot.deleteCompany(companyId)
    } catch (e) {
      // Si falla, la empresa desaparece localmente igualmente (toast en producción)
    }
  }, [])

  // Drag and drop
  const handleDrop = useCallback((targetStage) => {
    if (!draggingId || targetStage === dragOverStage) {
      setDraggingId(null)
      setDragOverStage(null)
      return
    }
    handleStageChange(draggingId, targetStage)
    setDraggingId(null)
    setDragOverStage(null)
  }, [draggingId, dragOverStage, handleStageChange])

  // Filtrar y agrupar
  const filtered = companies.filter(c => {
    const name = c.properties.name?.toLowerCase() || ''
    const matchSearch = !search || name.includes(search.toLowerCase())
    const matchOwner = !ownerFilter || c.properties.hubspot_owner_id === ownerFilter
    return matchSearch && matchOwner
  })

  const grouped = {}
  STAGES.forEach(s => { grouped[s.key] = [] })
  filtered.forEach(c => {
    const stage = c.properties.bp_etapa_empresa || 'nueva'
    if (grouped[stage]) grouped[stage].push(c)
    else grouped['nueva'].push(c)
  })

  return (
    <>
      <Topbar
        title="Pipeline de empresas"
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              placeholder="🔍 Filtrar empresas…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 200, padding: '5px 10px', fontSize: 13 }}
            />
            {isSupervisor && (
              <select
                value={ownerFilter}
                onChange={e => setOwnerFilter(e.target.value)}
                style={{ padding: '5px 8px', fontSize: 13 }}
              >
                <option value="">Todos los propietarios</option>
                {Object.entries(OWNER_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            )}
            <span style={{ fontSize: 12, color: '#6b778c', whiteSpace: 'nowrap' }}>
              {filtered.length} empresas
            </span>
          </div>
        }
      />

      {error && (
        <div className="content">
          <div className="error-msg">Error al cargar empresas: {error}</div>
        </div>
      )}

      <div className="kanban-wrapper">
        {STAGES.map(stage => (
          <div
            key={stage.key}
            className={`kanban-column${dragOverStage === stage.key ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOverStage(stage.key) }}
            onDragLeave={() => setDragOverStage(null)}
            onDrop={() => handleDrop(stage.key)}
          >
            {/* Header */}
            <div
              className="kanban-col-header"
              style={{ borderBottom: `2px solid ${stage.color}` }}
            >
              <span className="col-title" style={{ color: stage.color }}>{stage.label}</span>
              <span
                className="col-count"
                style={{ background: stage.bg, color: stage.color }}
              >
                {grouped[stage.key]?.length || 0}
              </span>
            </div>

            {/* Cards */}
            <div className="kanban-cards">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="kanban-skeleton-card" />
                  ))
                : (grouped[stage.key] || []).map(company => (
                    <KanbanCard
                      key={company.id}
                      company={company}
                      onStageChange={handleStageChange}
                      onDelete={handleDelete}
                      draggingId={draggingId}
                      setDraggingId={setDraggingId}
                    />
                  ))
              }
            </div>

            {/* Add button */}
            <button
              className="kanban-add-btn"
              onClick={() => { setCreateStage(stage.key); setShowCreate(true) }}
            >
              + Empresa
            </button>
          </div>
        ))}
      </div>

      {showCreate && (
        <RecordModal
          type="company"
          initialValues={{ bp_etapa_empresa: createStage }}
          onClose={() => setShowCreate(false)}
          onSaved={(r) => {
            setCompanies(prev => [...prev, r])
            setShowCreate(false)
          }}
        />
      )}
    </>
  )
}
