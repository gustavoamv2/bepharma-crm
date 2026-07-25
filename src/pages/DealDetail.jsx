import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from 'react-query'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ExternalLink, Mail, Pencil, Flag, Star, Phone, User, Paperclip, Download, Building2, ListChecks } from 'lucide-react'
import { hubspot, invalidateDashboard } from '../hooks/useApi'
import { useOwnerNames } from '../hooks/useTeam'
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

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '')
}

function ActivityText({ body }) {
  const text = stripHtml(body).slice(0, 1000)
  const parts = []
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let last = 0
  let match
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(
      <a key={match.index} href={match[2]} target="_blank" rel="noopener" style={{ color: '#0052cc', textDecoration: 'none', fontWeight: 600 }}>
        {match[1]}
      </a>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <div className="act-text">{parts.map((part, idx) => typeof part === 'string' ? <React.Fragment key={idx}>{part}</React.Fragment> : part)}</div>
}

function Prop({ label, value }) {
  return (
    <div className="prop-item">
      <div className="prop-label">{label}</div>
      <div className="prop-value">{value || '—'}</div>
    </div>
  )
}

// Empresa: Teléfono 1 = "phone", Teléfono 2 = "bp_telefonos_adicionales" (reusa
// propiedad ya existente), Teléfono 3 = "bp_telefono_3". Emails: Email 1 =
// "bp_email_empresa", Email 2/3 = "bp_email_2"/"bp_email_3".
const COMPANY_PHONE_FIELDS = [
  { key: 'phone', label: 'Teléfono 1' },
  { key: 'bp_telefonos_adicionales', label: 'Teléfono 2' },
  { key: 'bp_telefono_3', label: 'Teléfono 3' },
]
const COMPANY_EMAIL_FIELDS = [
  { key: 'bp_email_empresa', label: 'Email 1' },
  { key: 'bp_email_2', label: 'Email 2' },
  { key: 'bp_email_3', label: 'Email 3' },
]
// Contacto: Teléfono 1 = "phone", Teléfono 2 = "mobilephone" (estándar de
// HubSpot), Teléfono 3 = "bp_telefono_3". Emails: Email 1 = "email" (estándar),
// Email 2/3 = "bp_email_2"/"bp_email_3".
const CONTACT_PHONE_FIELDS = [
  { key: 'phone', label: 'Teléfono 1' },
  { key: 'mobilephone', label: 'Teléfono 2 (móvil)' },
  { key: 'bp_telefono_3', label: 'Teléfono 3' },
]
const CONTACT_EMAIL_FIELDS = [
  { key: 'email', label: 'Email 1' },
  { key: 'bp_email_2', label: 'Email 2' },
  { key: 'bp_email_3', label: 'Email 3' },
]
const phoneFieldsFor = (c) => (c.isCompany ? COMPANY_PHONE_FIELDS : CONTACT_PHONE_FIELDS)
const emailFieldsFor = (c) => (c.isCompany ? COMPANY_EMAIL_FIELDS : CONTACT_EMAIL_FIELDS)
const phonesOf = (c) => phoneFieldsFor(c).map(f => ({ label: f.label, value: c.properties?.[f.key] })).filter(x => x.value)
const emailsOf = (c) => emailFieldsFor(c).map(f => ({ label: f.label, value: c.properties?.[f.key] })).filter(x => x.value)

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
  const ownerNames = useOwnerNames()
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

  // Teléfono elegido manualmente para el Click-to-Call (al hacer click en
  // alguno de los hasta 3 teléfonos de un contacto/empresa en la lista) —
  // separado del "predeterminado" de la estrella, que solo afecta el email.
  // Guarda el número exacto (no solo el id) porque ahora cada contacto/empresa
  // puede tener más de un teléfono clickeable. No persiste entre visitas.
  const [callSelectedPhone, setCallSelectedPhone] = useState(null)
  const [callSelectedName, setCallSelectedName]   = useState(null)

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
  const hasParticipated = companies.some(c => c.properties?.bp_participo_eventos === 'true' || c.properties?.bp_participo_eventos === true)
  const portalId = '51580878'

  // Si la empresa vinculada tiene algún teléfono/email propio (hasta 3 cada
  // uno, más el contacto principal registrado en su ficha), se suma como un
  // "contacto" más — mismo tratamiento que un contacto real para Click-to-Call
  // y para el composer de email, cubriendo el caso en que aún no hay contactos
  // individuales cargados pero sí el dato general de la empresa. Se conservan
  // TODAS las propiedades originales (no solo phone/email) para que
  // phonesOf/emailsOf puedan leer los 3 teléfonos y 3 emails de la empresa.
  const companyContacts = companies
    .filter(co => COMPANY_PHONE_FIELDS.some(f => co.properties?.[f.key]) || COMPANY_EMAIL_FIELDS.some(f => co.properties?.[f.key]))
    .map(co => ({
      id: `company-${co.id}`,
      isCompany: true,
      properties: {
        ...co.properties,
        firstname: co.properties?.name || `Empresa #${co.id}`,
        lastname: '',
        jobtitle: 'Teléfono/email de la empresa',
      },
    }))
  const contacts = [...contactsRaw, ...companyContacts]

  // Determinar contacto activo (predeterminado o primero) — usado para email
  const activeContact = contacts.find(c => c.id === defaultContactId) || contacts[0] || null

  // Teléfono para el Click-to-Call: el que se clickeó manualmente
  // (callSelectedPhone) tiene prioridad; si no hay selección, usa el primer
  // teléfono disponible del contacto predeterminado (o el primero que tenga
  // algún teléfono entre sus hasta 3 registrados).
  const fallbackCallSource = contacts.find(c => c.id === defaultContactId && phonesOf(c).length > 0)
    || contacts.find(c => phonesOf(c).length > 0)
    || null
  const fallbackPhone = fallbackCallSource ? phonesOf(fallbackCallSource)[0].value : ''
  const fallbackName = fallbackCallSource
    ? [fallbackCallSource.properties?.firstname, fallbackCallSource.properties?.lastname].filter(Boolean).join(' ') || `Contacto #${fallbackCallSource.id}`
    : p.dealname
  const activePhone = callSelectedPhone || fallbackPhone
  const activeContactName = callSelectedName || fallbackName

  // El módulo de llamada solo tiene sentido si hay al menos un teléfono
  // (de un contacto o de la empresa, entre los hasta 3 de cada uno)
  const hasCallableContact = contacts.some(c => phonesOf(c).length > 0)

  // Opciones de email para el composer — TODOS los correos registrados,
  // tanto de los contactos (hasta 3 c/u) como de la empresa (hasta 3 + el
  // contacto principal), sin duplicar direcciones repetidas.
  const emailOptions = []
  const seenEmails = new Set()
  contacts.forEach(c => {
    const baseName = c.isCompany
      ? c.properties.firstname
      : [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || `Contacto #${c.id}`
    emailsOf(c).forEach(({ label, value }) => {
      const key = value.toLowerCase()
      if (seenEmails.has(key)) return
      seenEmails.add(key)
      emailOptions.push({ label: `${baseName} (${label})`, email: value })
    })
  })
  companies.forEach(co => {
    const email = co.properties?.bp_email_contacto_principal
    if (!email || seenEmails.has(email.toLowerCase())) return
    seenEmails.add(email.toLowerCase())
    const who = co.properties?.bp_contacto_principal_texto || 'Contacto principal'
    emailOptions.push({ label: `${who} (contacto principal de ${co.properties?.name || 'la empresa'})`, email })
  })
  // "Para" arranca solo con el correo del contacto predeterminado (o el
  // primero disponible) — los demás quedan como chips en el composer para
  // que el operador los agregue a mano si los necesita.
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

        {hasParticipated && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
            padding: '10px 14px', background: '#e6fffa', border: '1px solid #38b2ac',
            borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#0f766e'
          }}>
            📅 La empresa vinculada ya participó en eventos anteriores de BePharma
          </div>
        )}

        <div className={hasCallableContact ? 'detail-grid' : undefined}>
          <div className="detail-main">
            <div className="card" style={hasParticipated ? { borderLeft: '4px solid #38b2ac' } : undefined}>
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
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowTask(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ListChecks size={13} /> Tarea
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
                  {isSupervisor && (
                    <DeleteButton type="deal" id={id} name={p.dealname} onDeleted={() => nav('/deals')} />
                  )}
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
                    <Prop label="Propietario" value={ownerNames[p.hubspot_owner_id] || '—'} />
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
              <div className="card" style={hasParticipated ? { borderLeft: '4px solid #38b2ac' } : undefined}>
                <div className="card-header"><h2>Empresa vinculada</h2></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {companies.map(c => {
                    const cp = c.properties || {}
                    const participated = cp.bp_participo_eventos === 'true' || cp.bp_participo_eventos === true
                    const companyPhones = COMPANY_PHONE_FIELDS.map(f => ({ label: f.label, value: cp[f.key] })).filter(x => x.value)
                    const companyEmails = COMPANY_EMAIL_FIELDS.map(f => ({ label: f.label, value: cp[f.key] })).filter(x => x.value)
                    const principal = cp.bp_contacto_principal_texto || cp.bp_cargo_contacto_principal || cp.bp_email_contacto_principal || cp.bp_telefono_contacto_principal
                    return (
                      <div key={c.id}>
                        <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: 8 }}
                          onClick={() => nav(`/companies/${c.id}`)}>
                          {cp.name || `Empresa #${c.id}`}
                          {participated && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#0f766e', background: '#ccfbf1', padding: '1px 6px', borderRadius: 10 }}>
                              📅 PARTICIPÓ ANTES
                            </span>
                          )}
                        </button>
                        {(companyPhones.length > 0 || companyEmails.length > 0 || principal) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4, paddingLeft: 12, fontSize: 12, color: '#374151' }}>
                            {companyPhones.map(ph => {
                              const isSelected = callSelectedPhone === ph.value
                              return (
                                <button
                                  key={ph.label}
                                  type="button"
                                  title={`Usar ${ph.label} en Click-to-Call`}
                                  onClick={() => {
                                    setCallSelectedPhone(ph.value)
                                    setCallSelectedName(cp.name || `Empresa #${c.id}`)
                                    toast(`${ph.label} de ${cp.name || 'la empresa'} cargado en Click-to-Call`, 'success')
                                  }}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                    fontSize: 12, textAlign: 'left',
                                    color: isSelected ? '#0052cc' : '#374151',
                                    fontWeight: isSelected ? 600 : 400,
                                  }}
                                >
                                  <Phone size={11} color={isSelected ? '#0052cc' : '#6b778c'} /> {ph.label}: {ph.value}
                                </button>
                              )
                            })}
                            {companyEmails.map(em => (
                              <span key={em.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Mail size={11} color="#6b778c" /> {em.label}: {em.value}
                              </span>
                            ))}
                            {principal && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <User size={11} color="#6b778c" /> Contacto principal: {cp.bp_contacto_principal_texto || '—'}
                                {cp.bp_cargo_contacto_principal && ` · ${cp.bp_cargo_contacto_principal}`}
                                {cp.bp_telefono_contacto_principal && ` · ${cp.bp_telefono_contacto_principal}`}
                                {cp.bp_email_contacto_principal && ` · ${cp.bp_email_contacto_principal}`}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Contactos ── */}
            {contacts.length > 0 && (
              <div className="card" style={hasParticipated ? { borderLeft: '4px solid #38b2ac' } : undefined}>
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
                            {phonesOf(c).map(ph => {
                              const isSelected = callSelectedPhone === ph.value
                              return (
                                <button
                                  key={ph.label}
                                  type="button"
                                  title={`Usar ${ph.label} en Click-to-Call`}
                                  onClick={() => {
                                    setCallSelectedPhone(ph.value)
                                    setCallSelectedName(name)
                                    toast(`${ph.label} de ${name} cargado en Click-to-Call`, 'success')
                                  }}
                                  style={{
                                    fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                    color: isSelected ? '#0052cc' : '#374151',
                                    fontWeight: isSelected ? 600 : 400,
                                  }}
                                >
                                  <Phone size={11} color={isSelected ? '#0052cc' : '#6b778c'} />{ph.value}
                                  <span style={{ fontSize: 10, color: '#94a3b8' }}>({ph.label})</span>
                                </button>
                              )
                            })}
                            {emailsOf(c).map(em => (
                              <span key={em.label} style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Mail size={11} color="#6b778c" />{em.value}
                                <span style={{ fontSize: 10, color: '#94a3b8' }}>({em.label})</span>
                              </span>
                            ))}
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
          defaultAssignee={user?.ownerId}
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
              {item.body && <ActivityText body={item.body} />}
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
