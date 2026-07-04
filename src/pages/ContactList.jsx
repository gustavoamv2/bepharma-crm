import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus, X, BarChart2 } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import RecordModal from '../components/RecordModal'
import { BarChart } from '../components/Charts'

const fmt = (v) => v ? format(parseISO(v), 'dd MMM yy', { locale: es }) : '—'

// Mismas claves/orden que CONTACT_QUALITY_FILTERS en el backend
// (api/config/hubspotProperties.js) — solo el label se repite acá, el
// criterio de filtro real vive únicamente en el servidor.
const QUALITY_LABELS = {
  sinCorreo:   'Sin correo',
  sinTelefono: 'Sin teléfono',
  sinCargo:    'Sin cargo',
  sinEmpresa:  'Sin empresa',
  sinLinkedin: 'Sin LinkedIn',
}
const QUALITY_COLOR = '#de350b'

export default function ContactList() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [after, setAfter] = useState(null)
  const [history, setHistory] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [qualityFilter, setQualityFilter] = useState('')

  const resetPaging = () => { setAfter(null); setHistory([]) }

  const filterGroups = search ? [
    { filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: search }] },
    { filters: [{ propertyName: 'lastname',  operator: 'CONTAINS_TOKEN', value: search }] },
    { filters: [{ propertyName: 'phone',     operator: 'CONTAINS_TOKEN', value: search }] },
  ] : undefined

  const { data, isLoading, error } = useQuery(
    ['contacts', search, qualityFilter, after],
    () => hubspot.searchContacts({
      filterGroups,
      qualityFilter: qualityFilter || undefined,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      limit: 25,
      after,
    }),
    { keepPreviousData: true }
  )

  const { data: qualityMetrics } = useQuery('contacts-quality-metrics', hubspot.getContactQualityMetrics, {
    staleTime: 60_000,
  })
  const qualityChartData = Object.entries(QUALITY_LABELS).map(([key, label]) => ({
    key, label, count: qualityMetrics?.[key] ?? 0,
  }))

  const contacts = data?.results || []
  const nextAfter = data?.paging?.next?.after

  return (
    <>
      <Topbar title="Contactos" action={
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> Nuevo contacto
        </button>
      } />
      <div className="content">
        {/* Gráfico de calidad de datos — clic en una barra filtra el listado de abajo */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart2 size={14} style={{ color: QUALITY_COLOR }} />
              Calidad de datos
            </h2>
            <span style={{ fontSize: 11, color: '#6b778c' }}>clic en una barra para filtrar el listado</span>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            <BarChart
              data={qualityChartData}
              color={QUALITY_COLOR}
              onBarClick={(bar) => { setQualityFilter(bar.key); resetPaging() }}
            />
          </div>
        </div>

        <div className="search-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Buscar por nombre, apellido o teléfono…" value={search} onChange={e => { setSearch(e.target.value); resetPaging() }} style={{ flex: 1 }} />
          {qualityFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff1f0', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#de350b', flexShrink: 0 }}>
              {QUALITY_LABELS[qualityFilter]}
              <button onClick={() => { setQualityFilter(''); resetPaging() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#de350b', padding: 0, display: 'flex' }}>
                <X size={13} />
              </button>
            </div>
          )}
        </div>

        <div className="card">
          {isLoading ? (
            <div className="loading">Cargando contactos…</div>
          ) : error ? (
            <div className="card-body"><div className="error-msg">{error.message}</div></div>
          ) : contacts.length === 0 ? (
            <div className="empty">No se encontraron contactos</div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Email</th>
                      <th>Teléfono</th>
                      <th>Cargo</th>
                      <th>Empresa</th>
                      <th>País</th>
                      <th>Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map(c => (
                      <tr key={c.id} className="clickable" onClick={() => nav(`/contacts/${c.id}`)}>
                        <td style={{ fontWeight: 500 }}>
                          {[c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || '(sin nombre)'}
                        </td>
                        <td>{c.properties.email || '—'}</td>
                        <td>{c.properties.phone || '—'}</td>
                        <td>{c.properties.jobtitle || '—'}</td>
                        <td>{c.properties.company || '—'}</td>
                        <td>{c.properties.country || '—'}</td>
                        <td>{fmt(c.properties.createdate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <div className="pagination-info">Total: {data?.total ?? '?'} · mostrando {contacts.length}</div>
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
          type="contact"
          onClose={() => setShowCreate(false)}
          onSaved={(r) => {
            // Inject the new contact into the cache immediately (HubSpot search API
            // has ~1-2 min indexing delay, so newly created contacts won't show up
            // in search results right away without this)
            qc.setQueriesData({ queryKey: ['contacts'] }, (old) => {
              if (!old) return old
              return { ...old, results: [r, ...(old.results || [])] }
            })
            qc.invalidateQueries(['contacts'])
            nav(`/contacts/${r.id}`)
          }}
        />
      )}
    </>
  )
}
