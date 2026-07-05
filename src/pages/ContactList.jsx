import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus, X, BarChart2, FileSpreadsheet } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import RecordModal from '../components/RecordModal'
import { BarChart } from '../components/Charts'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { COUNTRIES } from '../constants/countries'

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

// Descarga un blob en el navegador con el nombre de archivo dado
function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

export default function ContactList() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const { addToast } = useToast()
  // Respeta bp_view_mode para que un supervisor simulando "vista operador"
  // vea el mismo catálogo de países acotado que vería el operador real.
  const viewMode = sessionStorage.getItem('bp_view_mode') || ''
  const isSupervisor = user?.role === 'supervisor' && viewMode !== 'operator'
  const [search, setSearch] = useState('')
  const [after, setAfter] = useState(null)
  const [history, setHistory] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [countryFilter, setCountryFilter] = useState('') // valor en inglés (propiedad HubSpot 'country'), igual que en Empresas
  // Checkboxes multi-select de calidad de datos (combinables entre sí con OR)
  const [qualityFilters, setQualityFilters] = useState([])
  const [exporting, setExporting] = useState(false)
  const toggleQuality = (key) => {
    setQualityFilters(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
    resetPaging()
  }

  // En vista de operador, el selector de país solo debe listar los países
  // que ese operador tiene configurados (user.bp_paises) — mismo patrón que
  // CompanyList. El supervisor sigue viendo todos.
  const availableCountries = (!isSupervisor && user?.bp_paises?.length)
    ? COUNTRIES.filter(c => user.bp_paises.includes(c.label))
    : COUNTRIES

  const resetPaging = () => { setAfter(null); setHistory([]) }

  // Búsqueda por nombre, apellido, teléfono y empresa — el país ya no se
  // busca por texto libre, se filtra con el selector dedicado de abajo
  // (mismo patrón que Empresas).
  const countryEqFilter = countryFilter ? { propertyName: 'country', operator: 'EQ', value: countryFilter } : null
  const searchFieldFilters = search ? [
    { propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: search },
    { propertyName: 'lastname',  operator: 'CONTAINS_TOKEN', value: search },
    { propertyName: 'phone',     operator: 'CONTAINS_TOKEN', value: search },
    { propertyName: 'company',   operator: 'CONTAINS_TOKEN', value: search },
  ] : null

  const filterGroups = searchFieldFilters
    ? searchFieldFilters.map(f => ({ filters: countryEqFilter ? [f, countryEqFilter] : [f] }))
    : (countryEqFilter ? [{ filters: [countryEqFilter] }] : undefined)

  const { data, isLoading, error } = useQuery(
    ['contacts', user?.username, search, countryFilter, qualityFilters, after],
    () => hubspot.searchContacts({
      filterGroups,
      qualityFilters: qualityFilters.length ? qualityFilters : undefined,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      limit: 25,
      after,
    }),
    { keepPreviousData: true }
  )

  // El gráfico "Calidad de datos" refleja la búsqueda activa del listado —
  // no incluye qualityFilters a propósito, para seguir mostrando la
  // distribución completa aunque haya un check ya seleccionado.
  const { data: qualityMetrics } = useQuery(
    ['contacts-quality-metrics', user?.username, search],
    () => hubspot.getContactQualityMetrics({ search: search || undefined }),
    { staleTime: 60_000, keepPreviousData: true }
  )
  const qualityChartData = Object.entries(QUALITY_LABELS).map(([key, label]) => ({
    key, label, count: qualityMetrics?.[key] ?? 0,
  }))

  const contacts = data?.results || []
  const nextAfter = data?.paging?.next?.after

  const filtroResumenParts = []
  if (search) filtroResumenParts.push(`Búsqueda: "${search}"`)
  if (countryFilter) filtroResumenParts.push(`País: ${availableCountries.find(c => c.en === countryFilter)?.label || countryFilter}`)
  if (qualityFilters.length) filtroResumenParts.push(qualityFilters.map(k => QUALITY_LABELS[k]).join(' o '))
  const filtroResumen = filtroResumenParts.join('; ')

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await hubspot.exportContacts({
        filterGroups,
        qualityFilters: qualityFilters.length ? qualityFilters : undefined,
        filtroResumen,
      })
      downloadBlob(blob, `BePharma_Contactos_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      addToast('No se pudo generar el Excel: ' + (e.response?.data?.error || e.message), 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Topbar title="Contactos" action={
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={exporting} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <FileSpreadsheet size={13} /> {exporting ? 'Generando…' : 'Exportar a Excel'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={13} /> Nuevo contacto
          </button>
        </div>
      } />
      <div className="content">
        {/* Gráfico de calidad de datos — clic en una barra o en un checkbox
            agrega/quita ese criterio del filtro (se pueden combinar varios) */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart2 size={14} style={{ color: QUALITY_COLOR }} />
              Calidad de datos
            </h2>
            <span style={{ fontSize: 11, color: '#6b778c' }}>clic en una barra o un check para filtrar (combinable)</span>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            <BarChart
              data={qualityChartData}
              color={QUALITY_COLOR}
              onBarClick={(bar) => toggleQuality(bar.key)}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f1f3' }}>
              {Object.entries(QUALITY_LABELS).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#42526e', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={qualityFilters.includes(key)}
                    onChange={() => toggleQuality(key)}
                    style={{ accentColor: QUALITY_COLOR, width: 14, height: 14 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="search-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Buscar por nombre, apellido, teléfono o empresa…" value={search} onChange={e => { setSearch(e.target.value); resetPaging() }} style={{ flex: 1 }} />
          <select
            value={countryFilter}
            onChange={e => { setCountryFilter(e.target.value); resetPaging() }}
            style={{ flex: '0 0 150px', width: 150, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #dfe1e6', color: '#42526e' }}
          >
            <option value="">Todos los países</option>
            {availableCountries.map(c => (
              <option key={c.en} value={c.en}>{c.label}</option>
            ))}
          </select>
          {qualityFilters.map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff1f0', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#de350b', flexShrink: 0 }}>
              {QUALITY_LABELS[key]}
              <button onClick={() => toggleQuality(key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#de350b', padding: 0, display: 'flex' }}>
                <X size={13} />
              </button>
            </div>
          ))}
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
