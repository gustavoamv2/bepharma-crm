import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import DealStageBadge from '../components/DealStageBadge'
import RecordModal from '../components/RecordModal'

const fmt = (v) => v ? format(parseISO(v), 'dd MMM yy', { locale: es }) : '—'
const money = (v) => v ? `$${Number(v).toLocaleString('es-MX')}` : '—'

const STAGES_OPTIONS = [
  { value: '', label: 'Todas las etapas' },
  { value: 'appointmentscheduled', label: 'Cita agendada' },
  { value: 'qualifiedtobuy', label: 'Calificado' },
  { value: 'presentationscheduled', label: 'Presentación' },
  { value: 'decisionmakerboughtin', label: 'Decision maker' },
  { value: 'contractsent', label: 'Contrato enviado' },
  { value: 'closedwon', label: 'Ganado' },
  { value: 'closedlost', label: 'Perdido' },
]

export default function DealList() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const location = useLocation()
  const preFilter = location.state?.filter || null

  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('')
  const [zona, setZona] = useState('')
  const [after, setAfter] = useState(null)
  const [history, setHistory] = useState([])
  const [showCreate, setShowCreate] = useState(false)

  const buildFilters = () => {
    const filters = []
    if (preFilter && !stage) {
      filters.push(...(preFilter.filters || []))
    }
    if (stage) filters.push({ propertyName: 'dealstage', operator: 'EQ', value: stage })
    if (zona) filters.push({ propertyName: 'bp_zona', operator: 'EQ', value: zona })
    if (search) filters.push({ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: search })
    return filters
  }

  const { data, isLoading, error } = useQuery(
    ['deals', search, stage, zona, after],
    () => hubspot.searchDeals({
      filters: buildFilters(),
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      limit: 25,
      after
    }),
    { keepPreviousData: true }
  )

  const deals = data?.results || []
  const nextAfter = data?.paging?.next?.after

  const goNext = () => { setHistory(h => [...h, after]); setAfter(nextAfter) }
  const goPrev = () => { const h = [...history]; setAfter(h.pop() || null); setHistory(h) }

  return (
    <>
      <Topbar title="Eventos" action={
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> Nuevo evento
        </button>
      } />

      <div className="content">
        <div className="search-bar">
          <input
            placeholder="Buscar evento…"
            value={search}
            onChange={e => { setSearch(e.target.value); setAfter(null); setHistory([]) }}
          />
        </div>
        <div className="filters">
          <select value={stage} onChange={e => { setStage(e.target.value); setAfter(null); setHistory([]) }}>
            {STAGES_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={zona} onChange={e => { setZona(e.target.value); setAfter(null); setHistory([]) }}>
            <option value="">Todas las zonas</option>
            <option value="norte">Norte</option>
            <option value="sur">Sur</option>
            <option value="centro">Centro</option>
            <option value="occidente">Occidente</option>
          </select>
          {preFilter && (
            <button className="btn btn-ghost btn-sm" onClick={() => nav('/deals', { state: null })}>
              × Quitar filtro rápido
            </button>
          )}
        </div>

        <div className="card">
          {isLoading ? (
            <div className="loading">Cargando eventos…</div>
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
                      <th>Etapa</th>
                      <th>Zona</th>
                      <th>Monto</th>
                      <th>Cierre</th>
                      <th>Últ. actividad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map(d => (
                      <tr key={d.id} className="clickable" onClick={() => nav(`/deals/${d.id}`)}>
                        <td style={{ fontWeight: 500 }}>{d.properties.dealname || '(sin nombre)'}</td>
                        <td><DealStageBadge stage={d.properties.dealstage} /></td>
                        <td>{d.properties.bp_zona || '—'}</td>
                        <td>{money(d.properties.amount)}</td>
                        <td>{fmt(d.properties.closedate)}</td>
                        <td>{fmt(d.properties.hs_lastmodifieddate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <div className="pagination-info">
                  Total: {data?.total ?? '?'} · mostrando {deals.length}
                </div>
                <div className="pagination-btns">
                  <button className="btn btn-ghost btn-sm" onClick={goPrev} disabled={history.length === 0}>← Anterior</button>
                  <button className="btn btn-ghost btn-sm" onClick={goNext} disabled={!nextAfter}>Siguiente →</button>
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
