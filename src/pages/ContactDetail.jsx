import React, { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from 'react-query'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ExternalLink, Mail, Linkedin, Pencil } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import CallWidget from '../components/CallWidget'
import EmailComposer from '../components/EmailComposer'
import RecordModal, { DeleteButton } from '../components/RecordModal'
import CreateTaskModal from '../components/CreateTaskModal'

const safeFmt = (v) => {
  if (!v) return '—'
  const d = new Date(isNaN(Number(v)) ? v : Number(v))
  return isNaN(d) ? '—' : format(d, 'dd MMMM yyyy', { locale: es })
}

function Prop({ label, value }) {
  return (
    <div className="prop-item">
      <div className="prop-label">{label}</div>
      <div className="prop-value">{value || '—'}</div>
    </div>
  )
}

export default function ContactDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [showEmail, setShowEmail] = useState(false)
  const [showEdit, setShowEdit]   = useState(false)
  const [showTask, setShowTask]   = useState(false)

  const { data: contact, isLoading, error } = useQuery(['contact', id], () => hubspot.getContact(id))

  if (isLoading) return <><Topbar title="Contacto" back /><div className="content"><div className="loading">Cargando…</div></div></>
  if (error) return <><Topbar title="Contacto" back /><div className="content"><div className="error-msg">{typeof error.message === 'string' ? error.message : 'Error al cargar el contacto'}</div></div></>

  const p = contact.properties
  const fullName = [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Contacto'
  const companies = contact.associations?.companies?.results || []
  const deals = contact.associations?.deals?.results || []
  const portalId = '51580878'
  const linkedin = p.hs_linkedin_url || p.linkedin_bio

  return (
    <>
      <Topbar title={fullName} back />
      <div className="content">
        <div className="breadcrumb">
          <Link to="/contacts">Contactos</Link>
          <span>/</span>
          <span>{fullName}</span>
          <a href={`https://app.hubspot.com/contacts/${portalId}/contact/${id}`} target="_blank" rel="noopener" style={{ marginLeft: 8 }}>
            <ExternalLink size={12} />
          </a>
        </div>

        <div className="detail-grid">
          <div className="detail-main">
            <div className="card">
              <div className="card-header">
                <h2>{fullName}</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {p.email && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowEmail(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Mail size={13} /> Email
                    </button>
                  )}
                  {linkedin && (
                    <a href={linkedin.startsWith('http') ? linkedin : `https://linkedin.com/in/${linkedin}`}
                      target="_blank" rel="noopener"
                      className="btn btn-ghost btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#0077b5' }}>
                      <Linkedin size={13} /> LinkedIn
                    </a>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Pencil size={13} /> Editar
                  </button>
                  <DeleteButton type="contact" id={id} name={fullName} onDeleted={() => nav('/contacts')} />
                </div>
              </div>
              <div className="card-body">
                <div className="props-grid">
                  <Prop label="Email" value={p.email ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <a href={`mailto:${p.email}`}>{p.email}</a>
                      <button onClick={() => setShowEmail(true)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0052cc', padding: 0, fontSize: 11 }}>
                        ✉ redactar
                      </button>
                    </span>
                  ) : null} />
                  <Prop label="Teléfono" value={p.phone} />
                  <Prop label="Cargo" value={p.jobtitle} />
                  <Prop label="Empresa" value={p.company} />
                  <Prop label="Creado" value={safeFmt(p.createdate)} />
                  <Prop label="Últ. modificación" value={safeFmt(p.hs_lastmodifieddate)} />
                  {linkedin && (
                    <Prop label="LinkedIn" value={
                      <a href={linkedin.startsWith('http') ? linkedin : `https://linkedin.com/in/${linkedin}`} target="_blank" rel="noopener">
                        Ver perfil ↗
                      </a>
                    } />
                  )}
                </div>
              </div>
            </div>

            {companies.length > 0 && (
              <div className="card">
                <div className="card-header"><h2>Empresa vinculada</h2></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {companies.map(c => (
                    <button key={c.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start' }}
                      onClick={() => nav(`/companies/${c.id}`)}>
                      {c.properties?.name || `Empresa #${c.id}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {deals.length > 0 && (
              <div className="card">
                <div className="card-header"><h2>Eventos ({deals.length})</h2></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {deals.map(d => (
                    <button key={d.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start' }}
                      onClick={() => nav(`/deals/${d.id}`)}>
                      💼 Evento #{d.id}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="detail-side">
            <CallWidget
              phone={p.phone}
              contactName={fullName}
              objectType="contacts"
              objectId={id}
              onActivityLogged={() => qc.invalidateQueries(['engagements-contact', id])}
            />

            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#0077b5', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Linkedin size={14} /> LinkedIn
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {linkedin && (
                  <a href={linkedin.startsWith('http') ? linkedin : `https://linkedin.com/in/${linkedin}`}
                    target="_blank" rel="noopener"
                    className="btn btn-ghost"
                    style={{ justifyContent: 'center', color: '#0077b5', borderColor: '#0077b5' }}>
                    Abrir perfil ↗
                  </a>
                )}
                <a href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(fullName)}&origin=FACETED_SEARCH`}
                  target="_blank" rel="noopener"
                  className="btn btn-ghost"
                  style={{ justifyContent: 'center', color: '#0077b5' }}>
                  {linkedin ? 'Buscar en LinkedIn' : 'Buscar en LinkedIn ↗'}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showEmail && (
        <EmailComposer
          defaultTo={p.email || ''}
          defaultSubject={`Contacto de BePharma — ${fullName}`}
          contactId={id}
          onClose={() => setShowEmail(false)}
        />
      )}

      {showEdit && (
        <RecordModal
          type="contact"
          record={contact}
          onClose={() => setShowEdit(false)}
          onSaved={() => qc.invalidateQueries(['contact', id])}
        />
      )}

      {showTask && (
        <CreateTaskModal
          onClose={() => setShowTask(false)}
          associatedObjectType="contacts"
          associatedObjectId={id}
          associatedObjectName={fullName}
        />
      )}

    </>
  )
}
