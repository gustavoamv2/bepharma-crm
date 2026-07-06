import React, { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from 'react-query'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ExternalLink, Linkedin, Pencil, ListChecks } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import RecordModal, { DeleteButton } from '../components/RecordModal'
import CreateTaskModal from '../components/CreateTaskModal'
import { useAuth } from '../contexts/AuthContext'

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
  const { user } = useAuth()
  const [showEdit, setShowEdit]   = useState(false)
  const [showTask, setShowTask]   = useState(false)

  const { data: contact, isLoading, error } = useQuery(['contact', id], () => hubspot.getContact(id))

  if (isLoading) return <><Topbar title="Contacto" back /><div className="content"><div className="loading">Cargando…</div></div></>
  if (error) return <><Topbar title="Contacto" back /><div className="content"><div className="error-msg">{typeof error.message === 'string' ? error.message : 'Error al cargar el contacto'}</div></div></>

  const p = contact.properties
  const fullName = [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Contacto'
  const companies = contact.associations?.companies?.results || []
  const deals = contact.associations?.deals?.results || []
  const hasParticipated = companies.some(c => c.properties?.bp_participo_eventos === 'true' || c.properties?.bp_participo_eventos === true)
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

        {hasParticipated && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
            padding: '10px 14px', background: '#e6fffa', border: '1px solid #38b2ac',
            borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#0f766e'
          }}>
            📅 La empresa vinculada ya participó en eventos anteriores de BePharma
          </div>
        )}

        <div className="detail-grid">
          <div className="detail-main">
            <div className="card" style={hasParticipated ? { borderLeft: '4px solid #38b2ac' } : undefined}>
              <div className="card-header">
                <h2>{fullName}</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowTask(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ListChecks size={13} /> Tarea
                  </button>
                  <DeleteButton type="contact" id={id} name={fullName} onDeleted={() => nav('/contacts')} />
                </div>
              </div>
              <div className="card-body">
                <div className="props-grid">
                  <Prop label="Email" value={p.email || null} />
                  <Prop label="Teléfono 1" value={p.phone} />
                  <Prop label="Teléfono 2 (móvil)" value={p.mobilephone} />
                  <Prop label="Teléfono 3" value={p.bp_telefono_3} />
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
                  <div className="prop-item" style={{ gridColumn: '1 / -1' }}>
                    <div className="prop-label">Anotaciones / Notas del contacto</div>
                    <div className="prop-value" style={{ whiteSpace: 'pre-wrap' }}>
                      {p.bp_notas_contacto || '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {companies.length > 0 && (
              <div className="card" style={hasParticipated ? { borderLeft: '4px solid #38b2ac' } : undefined}>
                <div className="card-header"><h2>Empresa vinculada</h2></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {companies.map(c => {
                    const participated = c.properties?.bp_participo_eventos === 'true' || c.properties?.bp_participo_eventos === true
                    return (
                      <button key={c.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: 8 }}
                        onClick={() => nav(`/companies/${c.id}`)}>
                        {c.properties?.name || `Empresa #${c.id}`}
                        {participated && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#0f766e', background: '#ccfbf1', padding: '1px 6px', borderRadius: 10 }}>
                            📅 PARTICIPÓ ANTES
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {deals.length > 0 && (
              <div className="card" style={hasParticipated ? { borderLeft: '4px solid #38b2ac' } : undefined}>
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
          defaultAssignee={user?.ownerId}
        />
      )}

    </>
  )
}
