import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus, X } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import RecordModal from '../components/RecordModal'

const fmt = (v) => v ? format(parseISO(v), 'dd MMM yy', { locale: es }) : '—'

const STAGE_LABELS = {
  nueva:           '🆕 Nueva',
  depuracion:      '🧹 Depuración',
  enriquecimiento: '💎 Enriquecimiento',
  calificada:      '✅ Calificada',
  contactada:      '📞 Contactada',
  seguimiento:     '🔁 Seguimiento',
  confirmada:      '🏆 Confirmada',
  descartada:      '❌ Descartada',
}

export default function CompanyList() {
  const nav = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [after, setAfter] = useState(null)
  const [history, setHistory] = useState([])
  const [showCreate, setShowCreate] = useState(false)

  // Pre-filter from Dashboard company pipeline navigation
  const stageFilter = location.state?.stage || null

  const filters = []
  if (search) filters.push({ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: search })
  if (stageFilter) filters.push({ propertyName: 'bp_etapa_empresa', operator: 'EQ', value: stageFilter })

  const { data, isLoading, error } = useQuery(
    ['companies', search, after],
    () => hubspot.searchCompanies({ filters, sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }], limit: 25, after }),
    { keepPreviousData: true }
  )

  const companies = data?.results || []
  const nextAfter = data?.paging?.next?.after

  return (
    <>
      <Topbar title="Empresas" action={
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> Nueva empresa
        </button>
      } />
      <div className="content">
        <div className="search-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Buscar empresa…" value={search} onChange={e => { setSearch(e.target.value); setAfter(null); setHistory([]) }} style={{ flex: 1 }} />
          {stageFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#e8f0fe', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#0052cc', flexShrink: 0 }}>
              Etapa: {STAGE_LABELS[stageFilter] || stageFilter}
              <button onClick={() => nav('/companies', { replace: true, state: {} })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0052cc', padding: 0, display: 'flex' }}>
                <X size={13} />
              </button>
            </div>
          )}
        </div>

        <div className="card">
          {isLoading ? (
            <div className="loading">Cargando empresas…</div>
          ) : error ? (
            <div className="card-body"><div className="error-msg">{error.message}</div></div>
          ) : companies.length === 0 ? (
            <div className="empty">No se encontraron empresas</div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empresa</th>
                      <th>Etapa</th>
                      <th>Ciudad</th>
                      <th>Teléfono</th>
                      <th>Creada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map(c => (
                      <tr key={c.id} className="clickable" onClick={() => nav(`/companies/${c.id}`)}>
                        <td style={{ fontWeight: 500 }}>{c.properties.name || '(sin nombre)'}</td>
                        <td>
                          {c.properties.bp_etapa_empresa
                            ? <span style={{ fontSize: 11, fontWeight: 600 }}>{STAGE_LABELS[c.properties.bp_etapa_empresa] || c.properties.bp_etapa_empresa}</span>
                            : <span style={{ color: '#adb5bd', fontSize: 11 }}>—</span>
                          }
                        </td>
                        <td>{c.properties.city || '—'}</td>
                        <td>{c.properties.phone || '—'}</td>
                        <td>{fmt(c.properties.createdate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <div className="pagination-info">Total: {data?.total ?? '?'} · mostrando {companies.length}</div>
                <div className="pagination-btns">
                  <button className="btn btn-ghost btn-sm" onClick={() => { const h=[...history]; setAfter(h.pop()||null); setHistory(h) }} disabled={history.length===0}>← Anterior</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setHistory(h=>[...h,after]); setAfter(nextAfter) }} disabled={!nextAfter}>Siguiente →</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <RecordModal
          type="company"
          onClose={() => setShowCreate(false)}
          onSaved={(r) => { qc.invalidateQueries(['companies']); nav(`/companies/${r.id}`) }}
        />
      )}
    </>
  )
}
