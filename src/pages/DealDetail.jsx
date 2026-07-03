import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from 'react-query'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ExternalLink, Mail, Pencil, Flag, Star, Phone, User, Paperclip, Download, Building2 } from 'lucide-react'
import { hubspot, invalidateDashboard } from '../hooks/useApi'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import Topbar from '../components/Topbar'
import DealStageBadge from '../components/DealStageBadge'
import CallWidget from '../components/CallWidget'
import EmailComposer from '../components/EmailComposer'
import RecordModal, { DeleteButton } from '../components/RecordModal'
import ActivityBar from '../components/ActivityBar'
import CreateTaskModal from '../components/CreateTaskModal'

const safeFmt = (v) => {
  if (!v) return '—'
  const d = new Date(isNaN(Number(v)) ? v : Number(v))
  return isNaN(d) ? '—' : format(d, 'dd MMMM yyyy', { locale: es })
}
const OWNER_NAMES = {
  '93615311': 'Roberto',
  '93621022': 'Yesenia',
  '93771980': 'Angel',
  '93771979': 'Gracie',
  '93771981': 'Carlos',
  '73112880': 'Sara',
}

// bp_estado_prospeccion es donde vive el estado real del deal en esta app
// (el dealstage estandar de HubSpot no se usa — ver DealStageBadge.jsx)
const ESTADO_PROSPECCION_LABELS = {
  nueva:              'Nueva',
  en_depuracion:      'En Depuración',
  en_enriquecimiento: 'En Enriquecimiento',
  contacto_enviado:   'Por Contactar',
  en_seguimiento:     'En Seguimiento',
  confirmada:         'Confirmada',
  no_participa:       'No Participa',
}

function Prop({ label, value }) {
  return (
    <div className="prop-item">
      <div className="prop-label">{label}</div>
      <div className="prop-value">{value || '—'}</div>
    </div>
  )
}

const ALERTA_CYCLE = { '': 'alerta_amarilla', alerta_amarilla: 'alerta_roja', alerta_roja: '' }
const ALERTA_COLORS = { alerta_roja: '#b91c1c', alerta_amarilla: '#b45309' }

function AlertToggle({ dealId, current, onUpdated }) {
  const [saving, setSaving] = useState(false)
  const next = ALERTA_CYCLE[current || ''] ?? ''
  const handleClick = async () => {
    setSaving(true)
    try { await hubspot.updateDeal(dealId, { bp_estado_alerta: next }); onUpdated() }
    finally { setSaving(false) }
  }
  const color = current ? ALERTA_COLORS[current] : '#d1d5db'
  const title = current === 'alerta_roja' ? 'Quitar alerta'
    : current === 'alerta_amarilla' ? 'Subir a alerta roja'
    : 'Levantar alerta amarilla'
  return (
    <button onClick={handleClick} disabled={saving} title={title}
      className="btn btn-ghost btn-sm"
      style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: saving ? 0.5 : 1 }}>
      <Flag size={13} fill={current ? color : 'none'} color={color} />
      {current === 'alerta_roja' ? 'Alerta roja' : current === 'alerta_amarilla' ? 'Alerta amarilla' : 'Alerta'}
    </button>
  )
}

export default function DealDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const { addToast: toast } = useToast()
  // Respeta bp_view_mode: si un supervisor esta simulando "vista operador"
  // (toggle del Dashboard), debe ver la ficha exactamente igual que un
  // operador real — antes solo miraba el rol y el boton de Alerta se
  // quedaba habilitado incluso en vista operador simulada.
  const [viewMode] = useState(() => sessionStorage.getItem('bp_view_mode') || '')
  const isSupervisor = user?.role === 'supervisor' && viewMode !== 'operator'
  const [tab, setTab]             = useState('info')
  const [showEmail, setShowEmail] = useState(false)
  const [showEdit, setShowEdit]   = useState(false)
  const [showTask, setShowTask]   = useState(false)

  // Contacto predeterminado — persiste en localStorage por deal
  const storageKey = `bp_default_contact_${id}`
  const [defaultContactId, setDefaultContactId] = useState(
    () => localStorage.getItem(storageKey) || null
  )
  const handleSetDefault = (contactId) => {
    localStorage.setItem(storageKey, contactId)
    setDefaultContactId(contactId)
  }

  // Número elegido manualmente para el Click-to-Call (al hacer click en el
  // teléfono de un contacto en la lista) — separado del "predeterminado" de
  // la estrella, que solo afecta el email. No persiste entre visitas.
  const [callSelectedId, setCallSelectedId] = useState(null)

  const { data: deal, isLoading, error } = useQuery(['deal', id], () => hubspot.getDeal(id))
  const { data: engData, isLoading: loadingEng } = useQuery(
    ['engagements-deal', id],
    () => hubspot.getEngagements('deals', id),
    { enabled: tab === 'actividades' }
  )

  if (isLoading) return <><Topbar title="Evento" back /><div className="content"><div className="loading">Cargando…</div></div></>
  if (error) return <><Topbar title="Evento" back /><div className="content"><div className="error-msg">{typeof error.message === 'string' ? error.message : 'Error al cargar el evento'}</div></div></>

  const p = deal.properties
  const contactsRaw = deal.associations?.contacts?.results || []
  const companies = deal.associations?.companies?.results || []
  const portalId = '51580878'

  // Si la empresa vinculada tiene teléfono y/o email propios, se suma como un
  // "contacto" más — mismo tratamiento que un contacto real para Click-to-Call
  // y para el composer de email, cubriendo el caso en que aún no hay contactos
  // individuales cargados pero sí el dato general de la empresa.
  const companyContacts = companies
    .filter(co => co.properties?.phone || co.properties?.email)
    .map(co => ({
      id: `company-${co.id}`,
      isCompany: true,
      properties: {
        firstname: co.properties?.name || `Empresa #${co.id}`,
        lastname: '',
        phone: co.properties?.phone || '',
        email: co.properties?.email || '',
        jobtitle: 'Teléfono/email de la empresa',
      },
    }))
  const contacts = [...contactsRaw, ...companyContacts]

  // Determinar contacto activo (predeterminado o primero) — usado para email
  const activeContact = contacts.find(c => c.id === defaultContactId) || contacts[0] || null

  // Contacto elegido para el Click-to-Call: el que se clickeó manualmente
  // (callSelectedId) tiene prioridad; si no hay selección, usa el mismo
  // que el email (predeterminado o primero con teléfono)
  const callContact = contacts.find(c => c.id === callSelectedId)
    || activeContact
    || contacts.find(c => c.properties?.phone)
    || null
  const activePhone = callContact?.properties?.phone || ''
  const activeContactName = callContact
    ? [callContact.properties?.firstname, callContact.properties?.lastname].filter(Boolean).join(' ') || `Contacto #${callContact.id}`
    : p.dealname

  // El módulo de llamada solo tiene sentido si hay al menos un contacto (o la empresa) con teléfono
  const hasCallableContact = contacts.some(c => c.properties?.phone)

  // Opciones de email para el composer (contactos + empresa, sin duplicar)
  const emailOptions = contacts
    .filter(c => c.properties?.email)
    .map(c => ({
      label: c.isCompany
        ? c.properties.firstname
        : [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || `Contacto #${c.id}`,
      email: c.properties.email,
    }))
  const defaultEmail = emailOptions[0]?.email || ''

  return (
    <>
      <Topbar title={p.dealname || 'Evento'} back />
      <div className="content">
        <div className="breadcrumb">
          <Link to="/deals">Eventos</Link>
          <span>/</span>
          <span>{p.dealname}</span>
          <a href={`https://app.hubspot.com/contacts/${portalId}/deal/${id}`} target="_blank" rel="noopener" style={{ marginLeft: 8 }}>
            <ExternalLink size={12} />
          </a>
        </div>

        <div className={hasCallableContact ? 'detail-grid' : undefined}>
          <div className="detail-main">
            <div className="card">
              <div className="card-header">
                <h2>{p.dealname}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <DealStageBadge stage={p.bp_estado_prospeccion} />
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowEmail(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Mail size={13} /> Email
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Pencil size={13} /> Editar
                  </button>
                  {isSupervisor && (
                    <AlertToggle
                      dealId={id}
                      current={p.bp_estado_alerta}
                      onUpdated={() => {
                        qc.invalidateQueries(['deal', id])
                        invalidateDashboard(qc)
                      }}
                    />
                  )}
                  <DeleteButton type="deal" id={id} name={p.dealname} onDeleted={() => nav('/deals')} />
                </div>
              </div>
              <div className="card-body">
                <div className="tabs">
                  {['info','actividades'].map(t => (
                    <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                      {t === 'info' ? 'Información' : 'Actividades'}
                    </button>
                  ))}
                </div>

                {tab === 'info' && (
                  <div className="props-grid">
                    <Prop label="Fecha de Creación" value={safeFmt(p.createdate)} />
                    <Prop label="Propietario" value={OWNER_NAMES[p.hubspot_owner_id] || '—'} />
                    <Prop label="Última Modificación" value={safeFmt(p.hs_lastmodifieddate)} />
                    <Prop label="Estado de la Empresa" value={ESTADO_PROSPECCION_LABELS[p.bp_estado_prospeccion] || p.bp_estado_prospeccion} />
                    <Prop label="Siguiente Paso" value={p.hs_next_step} />
                  </div>
                )}

                {tab === 'actividades' && (
                  <ActivityFeed items={engData?.results} loading={loadingEng} contacts={contacts} />
                )}
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

            {/* ── Contactos ── */}
            {contacts.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <h2>Contactos ({contacts.length})</h2>
                  {contacts.length > 1 && (
                    <span style={{ fontSize: 11, color: '#6b778c' }}>★ = contacto predeterminado</span>
                  )}
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {contacts.map(c => {
                    const cp = c.properties || {}
                    const name = [cp.firstname, cp.lastname].filter(Boolean).join(' ') || `Contacto #${c.id}`
                    const isDefault = c.id === (defaultContactId || contacts[0]?.id)
                    return (
                      <div key={c.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 12px', borderRadius: 8,
                        background: isDefault ? '#f0f7ff' : '#f8fafc',
                        border: `1px solid ${isDefault ? '#b3d4ff' : '#e2e8f0'}`,
                      }}>
                        {/* Selector predeterminado (solo si hay más de uno) */}
                        {contacts.length > 1 && (
                          <button
                            title={isDefault ? 'Contacto predeterminado' : 'Marcar como predeterminado'}
                            onClick={() => handleSetDefault(c.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', flexShrink: 0 }}
                          >
                            <Star size={15} fill={isDefault ? '#f59e0b' : 'none'} color={isDefault ? '#f59e0b' : '#94a3b8'} />
                          </button>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {c.isCompany ? (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ fontWeight: 600, padding: '2px 6px' }}
                                onClick={() => nav(`/companies/${c.id.replace('company-', '')}`)}
                              >
                                <Building2 size={12} style={{ marginRight: 4 }} />{name}
                              </button>
                            ) : (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ fontWeight: 600, padding: '2px 6px' }}
                                onClick={() => nav(`/contacts/${c.id}`)}
                              >
                                <User size={12} style={{ marginRight: 4 }} />{name}
                              </button>
                            )}
                            {cp.jobtitle && <span style={{ fontSize: 11, color: '#6b778c' }}>{cp.jobtitle}</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                            {cp.phone && (
                              <button
                                type="button"
                                title="Usar este número en Click-to-Call"
                                onClick={() => {
                                  setCallSelectedId(c.id)
                                  toast(`Número de ${name} cargado en Click-to-Call`, 'success')
                                }}
                                style={{
                                  fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                  color: callSelectedId === c.id ? '#0052cc' : '#374151',
                                  fontWeight: callSelectedId === c.id ? 600 : 400,
                                }}
                              >
                                <Phone size={11} color={callSelectedId === c.id ? '#0052cc' : '#6b778c'} />{cp.phone}
                              </button>
                            )}
                            {cp.email && (
                              <span style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Mail size={11} color="#6b778c" />{cp.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {hasCallableContact && (
            <div className="detail-side">
              <CallWidget
                phone={activePhone}
                contactName={activeContactName}
                objectType="deals"
                objectId={id}
                onActivityLogged={() => { setTab('actividades'); qc.invalidateQueries(['engagements-deal', id]) }}
              />
            </div>
          )}
        </div>
      </div>

      {showEmail && (
        <EmailComposer
          defaultTo={defaultEmail}
          defaultSubject={`Seguimiento: ${p.dealname}`}
          emailOptions={emailOptions}
          dealId={id}
          contactId={activeContact && !activeContact.isCompany ? activeContact.id : undefined}
          companyId={companies[0]?.id}
          onClose={() => setShowEmail(false)}
          onSent={() => { setTab('actividades'); qc.invalidateQueries(['engagements-deal', id]) }}
        />
      )}

      {showEdit && (
        <RecordModal
          type="deal"
          record={deal}
          companyIdForEdit={companies[0]?.id || null}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            qc.invalidateQueries(['deal', id])
            invalidateDashboard(qc)
          }}
        />
      )}

      {showTask && (
        <CreateTaskModal
          onClose={() => setShowTask(false)}
          associatedObjectType="deals"
          associatedObjectId={id}
          associatedObjectName={p.dealname}
        />
      )}

      <ActivityBar
        objectType="deals"
        objectId={id}
        objectName={p.dealname}
        onActivityLogged={() => { setTab('actividades'); qc.invalidateQueries(['engagements-deal', id]) }}
      />
    </>
  )
}

// ── ActivityFeed — usa formato v3 normalizado ──────────────────────────────────
function ActivityFeed({ items, loading, contacts = [] }) {
  if (loading) return <div className="loading">Cargando actividades…</div>
  if (!items) return <div className="empty">Sin actividades</div>
  if (items.length === 0) return <div className="empty">Sin actividades registradas en HubSpot</div>

  const typeIcon  = { NOTE: '📝', CALL: '📞', TASK: '✅', EMAIL: '📧', MEETING: '📅' }
  const typeName  = { NOTE: 'Nota', CALL: 'Llamada', TASK: 'Tarea', EMAIL: 'Email', MEETING: 'Reunión' }
  const typeClass = { NOTE: 'activity-note', CALL: 'activity-call', TASK: 'activity-task' }

  // Mapa email → nombre de contacto (para mostrar a quién se le envió el correo)
  const contactByEmail = {}
  contacts.forEach(c => {
    const email = c.properties?.email
    if (!email) return
    const name = [c.properties?.firstname, c.properties?.lastname].filter(Boolean).join(' ') || null
    contactByEmail[email.toLowerCase()] = name
  })
  const describeRecipients = (rawEmails) => {
    if (!rawEmails) return null
    return String(rawEmails).split(/[;,]/).map(s => s.trim()).filter(Boolean).map(email => {
      const name = contactByEmail[email.toLowerCase()]
      return name ? `${name} <${email}>` : email
    }).join(', ')
  }

  return (
    <div>
      {items.map((item, i) => {
        const date = item.createdAt
          ? format(new Date(item.createdAt), 'dd MMM yy HH:mm', { locale: es })
          : '—'
        return (
          <div key={item.id || i} className={`activity-item ${typeClass[item.type] || ''}`}>
            <div className="activity-icon">{typeIcon[item.type] || '•'}</div>
            <div className="activity-body">
              <div className="act-title">{typeName[item.type] || item.type}</div>
              <div className="act-meta">{date}</div>
              {item.type === 'EMAIL' && item.to && (
                <div className="act-meta">
                  Para: {describeRecipients(item.to)}
                  {item.cc && ` · Cc: ${describeRecipients(item.cc)}`}
                </div>
              )}
              {item.title && <div className="act-text" style={{ fontWeight: 500 }}>{item.title}</div>}
              {item.body && (
                <div className="act-text">{item.body.replace(/<[^>]+>/g, '').slice(0, 300)}</div>
              )}
              {item.durationMs && (
                <div className="act-meta">Duración: {Math.round(Number(item.durationMs) / 1000)}s</div>
              )}
              {item.attachments?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                  {item.attachments.map(att => (
                    <a
                      key={att.id}
                      href={att.url}
                      target="_blank"
                      rel="noopener"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, width: 'fit-content',
                        fontSize: 12, color: '#0052cc', background: '#f0f7ff', border: '1px solid #b3d4ff',
                        borderRadius: 6, padding: '4px 8px', textDecoration: 'none',
                      }}
                    >
                      <Paperclip size={11} /> {att.name} <Download size={11} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
