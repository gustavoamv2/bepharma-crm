import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import RecordModal from '../components/RecordModal'

const fmt = (v) => v ? format(parseISO(v), 'dd MMM yy', { locale: es }) : '—'

export default function ContactList() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [after, setAfter] = useState(null)
  const [history, setHistory] = useState([])
  const [showCreate, setShowCreate] = useState(false)

  const filterGroups = search ? [
    { filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: search }] },
    { filters: [{ propertyName: 'lastname',  operator: 'CONTAINS_TOKEN', value: search }] },
    { filters: [{ propertyName: 'phone',     operator: 'CONTAINS_TOKEN', value: search }] },
  ] : undefined

  const { data, isLoading, error } = useQuery(
    ['contacts', search, after],
    () => hubspot.searchContacts({ filterGroups, sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }], limit: 25, after }),
    { keepPreviousData: true }
  )

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
        <div className="search-bar">
          <input placeholder="Buscar por nombre, apellido o teléfono…" value={search} onChange={e => { setSearch(e.target.value); setAfter(null); setHistory([]) }} />
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
          onSaved={(r) => { qc.invalidateQueries(['contacts']); nav(`/contacts/${r.id}`) }}
        />
      )}
    </>
  )
}
