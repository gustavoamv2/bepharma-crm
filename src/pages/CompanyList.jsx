import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus, X } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import RecordModal from '../components/RecordModal'
import { useAuth } from '../contexts/AuthContext'
import { COUNTRIES } from '../constants/countries'

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
  const { user } = useAuth()
  // Solo supervisores pueden crear empresas nuevas. Respeta bp_view_mode para
  // que un supervisor simulando "vista operador" tampoco vea el boton.
  const viewMode = sessionStorage.getItem('bp_view_mode') || ''
  const isSupervisor = user?.role === 'supervisor' && viewMode !== 'operator'
  const [search, setSearch] = useState('')
  const [after, setAfter] = useState(null)
  const [history, setHistory] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [hideBlacklist, setHideBlacklist] = useState(true)
  const [countryFilter, setCountryFilter] = useState('') // valor en inglés (propiedad HubSpot 'country')
  const [contactsFilter, setContactsFilter] = useState('') // '' | 'with' | 'without'

  // Pre-filter from Dashboard company pipeline navigation
  const stageFilter = location.state?.stage || null

  const filters = []
  if (search) filters.push({ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: search })
  if (stageFilter) filters.push({ propertyName: 'bp_etapa_empresa', operator: 'EQ', value: stageFilter })
  if (countryFilter) filters.push({ propertyName: 'country', operator: 'EQ', value: countryFilter })

  const resetPaging = () => { setAfter(null); setHistory([]) }

  const { data, isLoading, error } = useQuery(
    ['companies', search, countryFilter, contactsFilter, after],
    () => hubspot.searchCompanies({ filters, contactsFilter: contactsFilter || undefined, sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }], limit: 25, after }),
    { keepPreviousData: true }
  )

  const allCompanies = data?.results || []
  const blacklistedCount = allCompanies.filter(c => c.properties.bp_lista_negra === 'true').length
  const companies = hideBlacklist ? allCompanies.filter(c => c.properties.bp_lista_negra !== 'true') : allCompanies
  const nextAfter = data?.paging?.next?.after

  return (
    <>
      <Topbar title="Empresas" action={
        isSupervisor && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={13} /> Nueva empresa
          </button>
        )
      } />
      <div className="content">
        <div className="search-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Buscar empresa…" value={search} onChange={e => { setSearch(e.target.value); resetPaging() }} style={{ flex: 1 }} />
          <select
            value={countryFilter}
            onChange={e => { setCountryFilter(e.target.value); resetPaging() }}
            style={{ flex: '0 0 150px', width: 150, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #dfe1e6', color: '#42526e' }}
          >
            <option value="">Todos los países</option>
            {COUNTRIES.map(c => (
              <option key={c.en} value={c.en}>{c.label}</option>
            ))}
          </select>
          <select
            value={contactsFilter}
            onChange={e => { setContactsFilter(e.target.value); resetPaging() }}
            style={{ flex: '0 0 150px', width: 150, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #dfe1e6', color: '#42526e' }}
          >
            <option value="">Con o sin contactos</option>
            <option value="with">Con contactos</option>
            <option value="without">Sin contactos</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b778c', flexShrink: 0, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={hideBlacklist}
              onChange={e => setHideBlacklist(e.target.checked)}
              style={{ accentColor: '#de350b', width: 14, height: 14 }}
            />
            Ocultar lista negra{blacklistedCount > 0 && ` (${blacklistedCount})`}
          </label>
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
                      <th>Contactos</th>
                      <th>Ciudad</th>
                      <th>Teléfono</th>
                      <th>Creada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map(c => (
                      <tr key={c.id} className="clickable" onClick={() => nav(`/companies/${c.id}`)}
                        style={c.properties.bp_lista_negra === 'true' ? { background: '#fff1f0' } : undefined}>
                        <td style={{ fontWeight: 500 }}>
                          {c.properties.name || '(sin nombre)'}
                          {c.properties.bp_lista_negra === 'true' && (
                            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#a8071a', background: '#ffccc7', padding: '1px 6px', borderRadius: 10 }}>
                              ⛔ LISTA NEGRA
                            </span>
                          )}
                        </td>
                        <td>
                          {c.properties.bp_etapa_empresa
                            ? <span style={{ fontSize: 11, fontWeight: 600 }}>{STAGE_LABELS[c.properties.bp_etapa_empresa] || c.properties.bp_etapa_empresa}</span>
                            : <span style={{ color: '#adb5bd', fontSize: 11 }}>—</span>
                          }
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {c.properties.num_associated_contacts
                            ? <span style={{ fontSize: 12, fontWeight: 600, color: '#0052cc' }}>{c.properties.num_associated_contacts}</span>
                            : <span style={{ color: '#adb5bd', fontSize: 11 }}>—</span>}
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
