import React, { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, AlertTriangle, Calendar, Flag } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import { useAuth } from '../contexts/AuthContext'
import Topbar from '../components/Topbar'
import RecordModal from '../components/RecordModal'

const ACTIVE_EVENT = 'BEPH-2026-09'

// Filtro por bp_estado_prospeccion (propiedad custom BePharma)
const ESTADO_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'nueva',              label: 'Nueva' },
  { value: 'en_depuracion',      label: 'En Depuracion' },
  { value: 'en_enriquecimiento', label: 'En Enriquecimiento' },
  { value: 'contacto_enviado',   label: 'Contacto enviado' },
  { value: 'en_seguimiento',     label: 'En seguimiento' },
  { value: 'confirmada',         label: 'Confirmada BePharma' },
  { value: 'no_participa',       label: 'No participa' },
]

const ALERTA_OPTIONS = [
  { value: '', label: 'Todas las alertas' },
  { value: 'alerta_roja',     label: 'Alerta roja' },
  { value: 'alerta_amarilla', label: 'Alerta amarilla' },
]

const OWNER_NAMES = {
  '93615311': 'Roberto',
  '93621022': 'Yesenia',
  '93771980': 'Angel',
  '93771979': 'Gracie',
  '93771981': 'Carlos',
  '73112880': 'Sara',
}

const ESTADO_LABELS = {
  nueva:              'Nueva',
  en_depuracion:      'En Depuracion',
  en_enriquecimiento: 'En Enriquecimiento',
  contacto_enviado:   'Contacto enviado',
  en_seguimiento:     'En seguimiento',
  confirmada:         'Confirmada BePharma',
  no_participa:       'No participa',
}

function formatBpDate(val) {
  if (!val) return '—'
  const n = Number(val)
  const d = isNaN(n) || n < 1e10 ? new Date(val) : new Date(n)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })
}

const ALERTA_COLORS = {
  alerta_roja:    '#b91c1c',
  alerta_amarilla:'#b45309',
}

// Ciclo: sin alerta → amarilla → roja → sin alerta
const ALERTA_CYCLE = { '': 'alerta_amarilla', alerta_amarilla: 'alerta_roja', alerta_roja: '' }

function AlertToggle({ dealId, current, onUpdated }) {
  const [saving, setSaving] = useState(false)
  const next = ALERTA_CYCLE[current || ''] ?? ''

  const handleClick = async (e) => {
    e.stopPropagation()
    setSaving(true)
    try {
      await hubspot.updateDeal(dealId, { bp_estado_alerta: next })
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  const color = current ? ALERTA_COLORS[current] : '#d1d5db'
  const title = current === 'alerta_roja' ? 'Quitar alerta'
    : current === 'alerta_amarilla' ? 'Subir a alerta roja'
    : 'Levantar alerta amarilla'

  return (
    <button
      onClick={handleClick}
      disabled={saving}
      title={title}
      style={{
        background: 'none', border: 'none', cursor: saving ? 'wait' : 'pointer',
        padding: '2px 4px', borderRadius: 4, display: 'flex', alignItems: 'center',
        opacity: saving ? 0.5 : 1,
      }}
    >
      <Flag size={14} fill={current ? color : 'none'} color={color} />
    </button>
  )
}

export default function DealList() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const location = useLocation()
  const { user } = useAuth()
  const [viewMode, setViewMode] = useState(() => sessionStorage.getItem('bp_view_mode') || '')
  useEffect(() => {
    const handler = () => setViewMode(sessionStorage.getItem('bp_view_mode') || '')
    window.addEventListener('bpViewModeChange', handler)
    return () => window.removeEventListener('bpViewModeChange', handler)
  }, [])
  const isSupervisor = user?.role === 'supervisor' && viewMode !== 'operator'

  const preFilter = location.state?.filter || null

  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState('')
  const [alerta, setAlerta] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [after, setAfter] = useState(null)
  const [history, setHistory] = useState([])
  const [showCreate, setShowCreate] = useState(false)

  const resetPage = () => { setAfter(null); setHistory([]) }

  const buildFilters = () => {
    const filters = [
      { propertyName: 'bp_evento_codigo', operator: 'EQ', value: ACTIVE_EVENT },
    ]
    if (preFilter && !estado) {
      filters.push(...(preFilter.filters || []))
    }
    if (estado) filters.push({ propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: estado })
    if (alerta)      filters.push({ propertyName: 'bp_estado_alerta',      operator: 'EQ', value: alerta })
    if (ownerFilter) filters.push({ propertyName: 'hubspot_owner_id',      operator: 'EQ', value: ownerFilter })
    if (search)      filters.push({ propertyName: 'dealname',              operator: 'CONTAINS_TOKEN', value: search })
    return filters
  }

  const { data, isLoading, error } = useQuery(
    ['deals', search, estado, alerta, ownerFilter, after, preFilter],
    () => hubspot.searchDeals({
      filters: buildFilters(),
      sorts: [{ propertyName: 'bp_ultima_actividad_operador', direction: 'DESCENDING' }],
      limit: 25,
      after,
    }),
    { keepPreviousData: true }
  )

  const deals = data?.results || []
  const nextAfter = data?.paging?.next?.after

  const goNext = () => { setHistory(h => [...h, after]); setAfter(nextAfter) }
  const goPrev = () => { const h = [...history]; setAfter(h.pop() || null); setHistory(h) }

  return (
    <>
      <Topbar
        title={isSupervisor ? 'Todos los eventos' : 'Mis eventos'}
        action={
          !isSupervisor && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreate(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <Plus size={13} /> Nuevo evento
            </button>
          )
        }
      />

      <div className="content">
        {/* Filtros */}
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <input
            placeholder="Buscar evento..."
            value={search}
            onChange={e => { setSearch(e.target.value); resetPage() }}
            style={{ minWidth: 180 }}
          />
          <select value={estado} onChange={e => { setEstado(e.target.value); resetPage() }}>
            {ESTADO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={alerta} onChange={e => { setAlerta(e.target.value); resetPage() }}>
            {ALERTA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {isSupervisor && (
            <select value={ownerFilter} onChange={e => { setOwnerFilter(e.target.value); resetPage() }}>
              <option value="">Todos los operadores</option>
              {Object.entries(OWNER_NAMES).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          {preFilter && (
            <button className="btn btn-ghost btn-sm" onClick={() => nav('/deals', { state: null })}>
              x Quitar filtro rapido
            </button>
          )}
        </div>

        <div className="card">
          {isLoading ? (
            <div className="loading">Cargando eventos...</div>
          ) : error ? (
            <div className="card-body"><div className="error-msg">Error: {error.message}</div></div>
          ) : deals.length === 0 ? (
            <div className="empty">No se encontraron eventos</div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>Owner</th>
                      <th>Zona</th>
                      <th>Estado</th>
                      <th>Proximo contacto</th>
                      <th>Ult. actividad</th>
                      <th>Alerta</th>
                      {isSupervisor && <th style={{ width: 36 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map(d => {
                      const p = d.properties
                      const alert = p.bp_estado_alerta
                      const isOverdue = p.bp_proximo_contacto && Number(p.bp_proximo_contacto) < Date.now()
                      return (
                        <tr key={d.id} className="clickable" onClick={() => nav(`/deals/${d.id}`)}>
                          <td style={{ fontWeight: 500 }}>{p.dealname || '(sin nombre)'}</td>
                          <td style={{ fontSize: 12 }}>{OWNER_NAMES[p.hubspot_owner_id] || '—'}</td>
                          <td style={{ fontSize: 12 }}>{p.bp_zona || '—'}</td>
                          <td style={{ fontSize: 12 }}>{ESTADO_LABELS[p.bp_estado_prospeccion] || p.bp_estado_prospeccion || '—'}</td>
                          <td style={{ fontSize: 12, color: isOverdue ? 'var(--danger)' : undefined }}>
                            {isOverdue && <Calendar size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />}
                            {formatBpDate(p.bp_proximo_contacto)}
                          </td>
                          <td style={{ fontSize: 12 }}>{formatBpDate(p.bp_ultima_actividad_operador)}</td>
                          <td>
                            {alert && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: ALERTA_COLORS[alert] || '#6b7280', fontWeight: 600 }}>
                                <AlertTriangle size={11} />
                                {alert === 'alerta_roja' ? 'Roja' : 'Amarilla'}
                              </span>
                            )}
                          </td>
                          {isSupervisor && (
                            <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                              <AlertToggle
                                dealId={d.id}
                                current={alert}
                                onUpdated={() => qc.invalidateQueries(['deals'])}
                              />
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <div className="pagination-info">
                  Total: {data?.total ?? '?'} · mostrando {deals.length}
                </div>
                <div className="pagination-btns">
                  <button className="btn btn-ghost btn-sm" onClick={goPrev} disabled={history.length === 0}>Anterior</button>
                  <button className="btn btn-ghost btn-sm" onClick={goNext} disabled={!nextAfter}>Siguiente</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <RecordModal
          type="deal"
          onClose={() => setShowCreate(false)}
          onSaved={(r) => { qc.invalidateQueries(['deals']); nav(`/deals/${r.id}`) }}
        />
      )}
    </>
  )
}
