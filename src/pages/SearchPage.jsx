import React, { useState } from 'react'
import { Search, UserPlus, Mail } from 'lucide-react'
import { apollo, rocketreach, hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import { useToast } from '../hooks/useToast'
import EmailComposer from '../components/EmailComposer'

export default function SearchPage() {
  const { addToast: toast } = useToast()
  const [source, setSource] = useState('apollo')
  const [form, setForm] = useState({ name: '', organization: '', title: '' })
  const [emailTarget, setEmailTarget] = useState(null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState({})

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!form.name && !form.organization) return toast('Ingresa nombre o empresa', 'error')
    setLoading(true)
    setResults([])
    try {
      let data
      if (source === 'apollo') {
        const r = await apollo.searchPeople({ name: form.name, organization_name: form.organization, title: form.title })
        data = (r.people || []).map(p => ({
          id: p.id,
          name: [p.first_name, p.last_name].filter(Boolean).join(' '),
          title: p.title,
          company: p.organization?.name,
          email: p.email,
          phone: p.phone_numbers?.[0]?.raw_number,
          linkedin: p.linkedin_url,
          source: 'apollo',
          raw: p
        }))
      } else {
        const r = await rocketreach.search({ name: form.name, current_employer: form.organization, title: form.title })
        data = (r.profiles || []).map(p => ({
          id: p.id,
          name: p.name,
          title: p.current_title,
          company: p.current_employer,
          email: p.emails?.[0],
          phone: p.phones?.[0],
          linkedin: p.linkedin_url,
          source: 'rocketreach',
          raw: p
        }))
      }
      setResults(data)
      if (data.length === 0) toast('Sin resultados. Prueba con otros términos.', 'default')
    } catch (err) {
      const errMsg = err.response?.data?.error
      toast('Error en búsqueda: ' + (typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg) || err.message), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async (person) => {
    setImporting(s => ({ ...s, [person.id]: true }))
    try {
      await hubspot.createContact({
        firstname: person.name?.split(' ')[0] || '',
        lastname: person.name?.split(' ').slice(1).join(' ') || '',
        email: person.email || '',
        phone: person.phone || '',
        jobtitle: person.title || '',
        company: person.company || '',
        hs_lead_status: 'NEW'
      })
      toast(`✓ ${person.name} importado a HubSpot`, 'success')
    } catch (err) {
      const msg = err.response?.data?.message || err.message
      if (msg?.includes('Contact already exists')) {
        toast(`${person.name} ya existe en HubSpot`, 'default')
      } else {
        toast('Error al importar: ' + msg, 'error')
      }
    } finally {
      setImporting(s => ({ ...s, [person.id]: false }))
    }
  }

  return (
    <>
      <Topbar title="Buscar Contactos" />
      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20 }}>
          {/* Panel búsqueda */}
          <div>
            <div className="card">
              <div className="card-header"><h2>Búsqueda</h2></div>
              <div className="card-body">
                <div className="form-group">
                  <label>Fuente</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['apollo','rocketreach'].map(s => (
                      <button key={s} className={`btn ${source === s ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                        onClick={() => { setSource(s); setResults([]) }}>
                        {s === 'apollo' ? 'Apollo.io' : 'RocketReach'}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <div className="form-group">
                    <label>Nombre</label>
                    <input placeholder="Juan García" value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Empresa</label>
                    <input placeholder="Laboratorios XYZ" value={form.organization}
                      onChange={e => setForm(f => ({ ...f, organization: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Cargo</label>
                    <input placeholder="Director, Gerente…" value={form.title}
                      onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    <Search size={14} /> {loading ? 'Buscando…' : 'Buscar'}
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Resultados */}
          <div>
            <div className="card" style={{ minHeight: 200 }}>
              <div className="card-header">
                <h2>Resultados {results.length > 0 ? `(${results.length})` : ''}</h2>
              </div>
              <div className="card-body search-panel">
                {loading && <div className="loading">Buscando en {source === 'apollo' ? 'Apollo.io' : 'RocketReach'}…</div>}
                {!loading && results.length === 0 && (
                  <div className="empty">Usa el formulario para buscar contactos.<br />Los resultados aparecerán aquí.</div>
                )}
                {results.map(person => (
                  <div key={person.id} className="search-result-item">
                    <div className="sri-info">
                      <div className="name">{person.name || '(sin nombre)'}</div>
                      <div className="meta">
                        {[person.title, person.company].filter(Boolean).join(' · ')}
                      </div>
                      {person.email && <div className="meta" style={{ marginTop: 4 }}>📧 {person.email}</div>}
                      {person.phone && <div className="meta">📞 {person.phone}</div>}
                      {person.linkedin && (
                        <div className="meta">
                          <a href={person.linkedin} target="_blank" rel="noopener">LinkedIn ↗</a>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                      <button className="btn btn-success btn-sm"
                        onClick={() => handleImport(person)} disabled={importing[person.id]}>
                        <UserPlus size={13} />
                        {importing[person.id] ? '…' : 'Importar'}
                      </button>
                      {person.email && (
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => setEmailTarget(person)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Mail size={12} /> Email
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {emailTarget && (
        <EmailComposer
          defaultTo={emailTarget.email}
          defaultSubject={`Contacto BePharma — ${emailTarget.name}`}
          onClose={() => setEmailTarget(null)}
        />
      )}
    </>
  )
}
