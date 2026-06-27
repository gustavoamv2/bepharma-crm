import React, { useState } from 'react'
import { Search, UserPlus, Mail } from 'lucide-react'
import { apollo, rocketreach, hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import { useToast } from '../hooks/useToast'
import EmailComposer from '../components/EmailComposer'

const DEFAULT_TITLES = [
  'Director',
  'General Manager',
  'CEO',
  'Commercial Director',
  'Business Development',
  'Marketing Director',
  'Sales Manager',
  'Procurement',
]

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

const tokenList = (value) => normalize(value).split(/[^a-z0-9]+/).filter(t => t.length > 2)

const includesAnyToken = (candidate, expected) => {
  const text = normalize(candidate)
  const expectedTokens = tokenList(expected)
  return Boolean(text && expectedTokens.length && expectedTokens.some(t => text.includes(t)))
}

const scorePerson = (person, form) => {
  let score = 0
  if (includesAnyToken(person.company, form.organization)) score += 45
  if (includesAnyToken(person.title, form.title)) score += 25
  if (person.email) score += 15
  if (person.phone) score += 10
  if (person.linkedin) score += 5
  return score
}

const dedupeResults = (items) => {
  const seen = new Set()
  return items.filter(item => {
    const key = normalize(item.email || item.linkedin || `${item.name}-${item.company}`)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function SourceBadge({ source }) {
  return <span className="badge badge-blue">{source === 'apollo' ? 'Apollo' : 'RocketReach'}</span>
}

function ScoreBadge({ score }) {
  const cls = score >= 60 ? 'badge-green' : score >= 35 ? 'badge-yellow' : 'badge-gray'
  return <span className={`badge ${cls}`} style={{ marginLeft: 6 }}>Relevancia {score}</span>
}

export default function SearchPage() {
  const { addToast: toast } = useToast()
  const [source, setSource] = useState('both')
  const [form, setForm] = useState({
    name: '',
    organization: '',
    domain: '',
    title: DEFAULT_TITLES.join(', '),
    location: '',
  })
  const [emailTarget, setEmailTarget] = useState(null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState({})

  const handleSearch = async (event) => {
    event.preventDefault()
    if (!form.name && !form.organization && !form.domain) {
      return toast('Ingresa nombre, empresa o dominio', 'error')
    }

    setLoading(true)
    setResults([])

    const searches = []

    if (source === 'apollo' || source === 'both') {
      searches.push(
        apollo.searchPeople({
          name: form.name,
          organization_name: form.organization,
          organization_domain: form.domain,
          title: form.title,
          location: form.location,
        })
          .then(r => (r.people || []).map(p => ({
            id: `apollo-${p.id}`,
            providerId: p.id,
            name: [p.first_name, p.last_name].filter(Boolean).join(' '),
            title: p.title,
            company: p.organization?.name,
            email: p.email,
            phone: p.phone_numbers?.[0]?.raw_number,
            linkedin: p.linkedin_url,
            source: 'apollo',
            raw: p,
          })))
          .catch(err => {
            toast('Apollo: ' + (err.response?.data?.hint || err.response?.data?.error || err.message), 'error')
            return []
          })
      )
    }

    if (source === 'rocketreach' || source === 'both') {
      searches.push(
        rocketreach.search({
          name: form.name,
          current_employer: form.organization || form.domain,
          title: form.title,
          location: form.location,
        })
          .then(r => (r.profiles || []).map(p => ({
            id: `rocketreach-${p.id}`,
            providerId: p.id,
            name: p.name,
            title: p.current_title,
            company: p.current_employer,
            email: p.emails?.[0],
            phone: p.phones?.[0],
            linkedin: p.linkedin_url,
            source: 'rocketreach',
            raw: p,
          })))
          .catch(err => {
            const errMsg = err.response?.data?.error?.message || err.response?.data?.error || err.message
            toast('RocketReach: ' + errMsg, 'error')
            return []
          })
      )
    }

    try {
      const data = dedupeResults((await Promise.all(searches)).flat())
        .map(person => ({ ...person, score: scorePerson(person, form) }))
        .sort((a, b) => b.score - a.score)

      setResults(data)
      if (data.length === 0) toast('Sin resultados. Prueba con dominio, pais o cargos mas especificos.', 'default')
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
        hs_lead_status: 'NEW',
      })
      toast(`${person.name} importado a HubSpot`, 'success')
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
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20 }}>
          <div>
            <div className="card">
              <div className="card-header"><h2>Busqueda</h2></div>
              <div className="card-body">
                <div className="form-group">
                  <label>Fuente</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['both', 'apollo', 'rocketreach'].map(s => (
                      <button
                        key={s}
                        type="button"
                        className={`btn ${source === s ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                        onClick={() => { setSource(s); setResults([]) }}
                      >
                        {s === 'both' ? 'Ambas' : s === 'apollo' ? 'Apollo.io' : 'RocketReach'}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleSearch}>
                  <div className="form-group">
                    <label>Nombre</label>
                    <input
                      placeholder="Juan Garcia"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Empresa</label>
                    <input
                      placeholder="Laboratorios XYZ"
                      value={form.organization}
                      onChange={e => setForm(f => ({ ...f, organization: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Dominio</label>
                    <input
                      placeholder="empresa.com"
                      value={form.domain}
                      onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Cargos objetivo</label>
                    <input
                      placeholder="Director, CEO, Business Development"
                      value={form.title}
                      onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Ubicacion</label>
                    <input
                      placeholder="Mexico, Spain, United States..."
                      value={form.location}
                      onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    <Search size={14} /> {loading ? 'Buscando...' : 'Buscar'}
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div>
            <div className="card" style={{ minHeight: 200 }}>
              <div className="card-header">
                <h2>Resultados {results.length > 0 ? `(${results.length})` : ''}</h2>
              </div>
              <div className="card-body search-panel">
                {loading && <div className="loading">Buscando contactos...</div>}
                {!loading && results.length === 0 && (
                  <div className="empty">Busca por empresa, dominio o cargo. Los resultados mas relevantes apareceran primero.</div>
                )}
                {results.map(person => (
                  <div key={person.id} className="search-result-item">
                    <div className="sri-info">
                      <div className="name">{person.name || '(sin nombre)'}</div>
                      <div className="meta">
                        {[person.title, person.company].filter(Boolean).join(' · ')}
                      </div>
                      <div className="meta" style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        <SourceBadge source={person.source} />
                        <ScoreBadge score={person.score} />
                        {includesAnyToken(person.company, form.organization) && <span className="badge badge-green">Empresa coincide</span>}
                        {includesAnyToken(person.title, form.title) && <span className="badge badge-purple">Cargo objetivo</span>}
                      </div>
                      {person.email && <div className="meta" style={{ marginTop: 4 }}>Email: {person.email}</div>}
                      {person.phone && <div className="meta">Telefono: {person.phone}</div>}
                      {person.linkedin && (
                        <div className="meta">
                          <a href={person.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                      <button className="btn btn-success btn-sm" onClick={() => handleImport(person)} disabled={importing[person.id]}>
                        <UserPlus size={13} />
                        {importing[person.id] ? '...' : 'Importar'}
                      </button>
                      {person.email && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setEmailTarget(person)}
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
          defaultSubject={`Contacto BePharma - ${emailTarget.name}`}
          onClose={() => setEmailTarget(null)}
        />
      )}
    </>
  )
}
