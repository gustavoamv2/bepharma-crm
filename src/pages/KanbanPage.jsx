import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import { pipeline } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import { useAuth } from '../contexts/AuthContext'
import { Building2, User, MapPin, AlertTriangle, Calendar, ArrowRight } from 'lucide-react'

// Columnas del Kanban basadas en bp_estado_prospeccion (propiedad custom BePharma)
const STAGES = [
  { key: 'nueva',               label: 'Nueva',              color: '#2563eb', bg: '#eff6ff' },
  { key: 'en_depuracion',       label: 'En Depuracion',      color: '#d97706', bg: '#fffbeb' },
  { key: 'en_enriquecimiento',  label: 'En Enriquecimiento', color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'contacto_enviado',    label: 'Contacto enviado',   color: '#0369a1', bg: '#f0f9ff' },
  { key: 'en_seguimiento',      label: 'En seguimiento',     color: '#0f766e', bg: '#f0fdfa' },
  { key: 'confirmada',          label: 'Confirmada BePharma',color: '#15803d', bg: '#f0fdf4' },
  { key: 'no_participa',        label: 'No participa',       color: '#b91c1c', bg: '#fef2f2' },
]

const TERMINAL_STAGES = ['confirmada', 'no_participa']

const OWNER_NAMES = {
  '93615311': 'Roberto',
  '93621022': 'Yesenia',
  '93771980': 'Angel',
  '93771979': 'Gracie',
  '93771981': 'Carlos',
  '73112880': 'Sara',
}

const ALERT_COLORS = {
  alerta_roja:    '#b91c1c',
  alerta_amarilla:'#b45309',
}

function formatDate(val) {
  if (!val) return null
  const d = new Date(Number(val))
  if (isNaN(d)) return null
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

// Abrevia la zona al primer segmento antes del primer "·"
function shortZona(zona) {
  if (!zona) return ''
  const part = zona.split('·')[0].trim()
  return part.length > 8 ? part.slice(0, 7) + '…' : part
}

// ── Card compacta ─────────────────────────────────────────────────────────────

function EventCard({ deal, overlay = false }) {
  const nav = useNavigate()
  const p = deal.properties
  const alert = p.bp_estado_alerta
  const owner = OWNER_NAMES[p.hubspot_owner_id] || ''
  const zona = shortZona(p.bp_zona)
  const ownerLabel = [owner, zona].filter(Boolean).join(' · ')
  const proximo = formatDate(p.bp_proximo_contacto)
  const isOverdue = p.bp_proximo_contacto && Number(p.bp_proximo_contacto) < Date.now()

  return (
    <div
      className={`kev-card${overlay ? ' kev-card--overlay' : ''}`}
      onClick={() => !overlay && nav(`/deals/${deal.id}`)}
      style={{ cursor: overlay ? 'grabbing' : 'pointer' }}
    >
      {alert && (
        <div className="kev-alert" style={{ color: ALERT_COLORS[alert] || '#6b7280' }}>
          <AlertTriangle size={10} />
          <span>{alert === 'alerta_roja' ? 'Alerta roja' : 'Alerta amarilla'}</span>
        </div>
      )}

      <div className="kev-name">{p.dealname || '(sin nombre)'}</div>

      <div className="kev-footer">
        {ownerLabel && (
          <span className="kev-pill kev-pill--owner">{ownerLabel}</span>
        )}
        {proximo && (
          <span className="kev-pill" style={{ color: isOverdue ? '#b91c1c' : '#0f766e', background: isOverdue ? '#fef2f2' : '#f0fdfa' }}>
            {proximo}{isOverdue ? ' !' : ''}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Draggable Card wrapper ────────────────────────────────────────────────────

function DraggableCard({ deal, disabled }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id })
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : { ...listeners, ...attributes })}
      style={{ opacity: isDragging ? 0.35 : 1, touchAction: 'none' }}
    >
      <EventCard deal={deal} />
    </div>
  )
}

// ── Droppable Column ──────────────────────────────────────────────────────────

function KanbanColumn({ stage, deals, loading, canDrop, collapsed, onToggleCollapse }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key })

  if (collapsed) {
    return (
      <div
        className="kev-column-collapsed"
        style={{ borderTopColor: stage.color }}
        onClick={() => onToggleCollapse(stage.key)}
        title={`Expandir: ${stage.label} (${deals.length})`}
      >
        <span className="kev-col-collapsed-count" style={{ color: stage.color }}>{deals.length}</span>
        <span className="kev-col-collapsed-label" style={{ color: stage.color }}>{stage.label}</span>
        <ArrowRight size={12} style={{ color: stage.color, marginTop: 4 }} />
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      className={`kev-column${isOver && canDrop ? ' kev-column--over' : ''}`}
    >
      <div className="kev-col-header" style={{ borderTopColor: stage.color }}>
        <span
          style={{ color: stage.color, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
          onClick={() => onToggleCollapse(stage.key)}
          title="Colapsar columna"
        >
          {stage.label}
        </span>
        <span className="kev-col-count" style={{ background: stage.bg, color: stage.color }}>
          {deals.length}
        </span>
      </div>

      <div className="kev-cards">
        {loading
          ? Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="kev-skeleton" />
            ))
          : deals.map(deal => (
              <DraggableCard key={deal.id} deal={deal} disabled={false} />
            ))
        }
      </div>
    </div>
  )
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="kev-confirm-backdrop">
      <div className="kev-confirm">
        <p>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
          <button className="btn-primary" onClick={onConfirm}>Confirmar</button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function KanbanPage() {
  const { user } = useAuth()
  const [deals, setDeals] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [activeDeal, setActiveDeal] = useState(null)   // deal being dragged
  const [confirm, setConfirm] = useState(null)          // { dealId, fromStage, toStage }

  const isSupervisor = user?.role === 'supervisor'

  // Columnas terminales colapsadas por defecto
  const [collapsedCols, setCollapsedCols] = useState(new Set(TERMINAL_STAGES))
  const toggleCollapse = (key) => setCollapsedCols(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // Carga inicial
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await pipeline.getDeals()
        if (!cancelled) {
          setDeals(data.results || [])
          setTruncated(data.truncated || false)
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Mueve un deal a una nueva etapa con optimistic update y rollback
  const moveToStage = useCallback(async (dealId, toStage) => {
    const prev = deals.find(d => d.id === dealId)
    if (!prev || prev.properties.bp_estado_prospeccion === toStage) return

    // Optimistic update
    setDeals(all => all.map(d =>
      d.id === dealId ? { ...d, properties: { ...d.properties, bp_estado_prospeccion: toStage } } : d
    ))

    try {
      await pipeline.updateStage(dealId, toStage)
    } catch (e) {
      // Rollback
      setDeals(all => all.map(d =>
        d.id === dealId ? prev : d
      ))
      const errData = e.response?.data
      const msg = typeof errData?.error === 'string'
        ? errData.error
        : errData?.message || e.message || 'No se pudo mover el evento. Intenta de nuevo.'
      alert(msg)
    }
  }, [deals])

  const handleDragStart = ({ active }) => {
    const deal = deals.find(d => d.id === active.id)
    setActiveDeal(deal || null)
  }

  const handleDragEnd = ({ active, over }) => {
    setActiveDeal(null)
    if (!over || active.id === over.id) return
    const toStage = over.id
    const deal = deals.find(d => d.id === active.id)
    if (!deal) return

    if (TERMINAL_STAGES.includes(toStage)) {
      const stageLabel = STAGES.find(s => s.key === toStage)?.label || toStage
      setConfirm({ dealId: active.id, toStage, message: `Mover a "${stageLabel}". Esta accion cambia el estado en HubSpot. Confirmar?` })
      return
    }

    moveToStage(active.id, toStage)
  }

  // Filtrar y agrupar — búsqueda por nombre de empresa
  const filtered = deals.filter(d => {
    const companyName = (d._companyName || '').toLowerCase()
    const matchSearch = !search || companyName.includes(search.toLowerCase())
    const matchOwner = !ownerFilter || d.properties.hubspot_owner_id === ownerFilter
    return matchSearch && matchOwner
  })

  const grouped = Object.fromEntries(STAGES.map(s => [s.key, []]))
  filtered.forEach(d => {
    const stage = d.properties.bp_estado_prospeccion || 'nueva'
    if (grouped[stage]) grouped[stage].push(d)
    else grouped['nueva'].push(d)
  })

  return (
    <>
      <Topbar title="Pipeline de Eventos" />

      {/* Barra de filtros propia — fuera del Topbar para tener ancho completo */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 16px', borderBottom: '1px solid #e8edf2', background: 'var(--sidebar-bg, #f4f5f7)' }}>
        <input
          placeholder="Buscar empresa..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 200, flex: '1 1 200px', padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d8e0ea', background: '#fff' }}
        />
        {isSupervisor && (
          <select
            value={ownerFilter}
            onChange={e => setOwnerFilter(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d8e0ea', background: '#fff' }}
          >
            <option value="">Todos los operadores</option>
            {Object.entries(OWNER_NAMES).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        <span style={{ fontSize: 12, color: '#5d6b7a', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
          {loading ? 'Cargando…' : `${filtered.length} eventos`}
        </span>
      </div>

      {error && (
        <div style={{ margin: '12px 16px' }}>
          <div className="error-msg">Error al cargar eventos: {error}</div>
        </div>
      )}

      {truncated && (
        <div style={{ margin: '0 16px 8px', padding: '7px 14px', background: '#fff8e1', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700 }}>Aviso:</span> El evento activo tiene mas de 500 registros. El Kanban muestra los 500 mas recientes. Usa la vista Lista para ver todos.
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="kev-board">
          {STAGES.map(stage => (
            <KanbanColumn
              key={stage.key}
              stage={stage}
              deals={grouped[stage.key] || []}
              loading={loading}
              canDrop={activeDeal?.properties?.bp_estado_prospeccion !== stage.key}
              collapsed={collapsedCols.has(stage.key)}
              onToggleCollapse={toggleCollapse}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDeal && <EventCard deal={activeDeal} overlay />}
        </DragOverlay>
      </DndContext>

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={() => {
            moveToStage(confirm.dealId, confirm.toStage)
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}
