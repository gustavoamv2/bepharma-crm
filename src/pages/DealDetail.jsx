import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from 'react-query'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ExternalLink, Mail, Pencil, Flag, Star, Phone, User } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import { useAuth } from '../contexts/AuthContext'
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
const money = (v) => v ? `$${Number(v).toLocaleString('es-MX')}` : '—'

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
  const isSupervisor = user?.role === 'supervisor'
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

  const { data: deal, isLoading, error } = useQuery(['deal', id], () => hubspot.getDeal(id))
  const { data: engData, isLoading: loadingEng } = useQuery(
    ['engagements-deal', id],
    () => hubspot.getEngagements('deals', id),
    { enabled: tab === 'actividades' }
  )

  if (isLoading) return <><Topbar title="Evento" back /><div className="content"><div className="loading">Cargando…</div></div></>
  if (error) return <><Topbar title="Evento" back /><div className="content"><div className="error-msg">{typeof error.message === 'string' ? error.message : 'Error al cargar el evento'}</div></div></>

  const p = deal.properties
  const contacts = deal.associations?.contacts?.results || []
  const companies = deal.associations?.companies?.results || []
  const portalId = '51580878'

  // Determinar contacto activo (predeterminado o primero)
  const activeContact = contacts.find(c => c.id === defaultContactId) || contacts[0] || null
  const activePhone = activeContact?.properties?.phone || ''
  const activeContactName = activeContact
    ? [activeContact.properties?.firstname, activeContact.properties?.lastname].filter(Boolean).join(' ') || `Contacto #${activeContact.id}`
    : p.dealname

  // Opciones de email para el composer
  const emailOptions = [
    ...contacts
      .filter(c => c.properties?.email)
      .map(c => ({
        label: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || `Contacto #${c.id}`,
        email: c.properties.email,
      })),
    ...companies
      .filter(c => c.properties?.email)
      .map(c => ({ label: c.properties.name || `Empresa #${c.id}`, email: c.properties.email })),
  ]
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

        <div className="detail-grid">
          <div className="detail-main">
            <div className="card">
              <div className="card-header">
                <h2>{p.dealname}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <DealStageBadge stage={p.dealstage} />
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
                      onUpdated={() => qc.invalidateQueries(['deal', id])}
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
                    <Prop label="Monto" value={money(p.amount)} />
                    <Prop label="Fecha cierre" value={safeFmt(p.closedate)} />
                    <Prop label="Creado" value={safeFmt(p.createdate)} />
                    <Prop label="Últ. modificación" value={safeFmt(p.hs_lastmodifieddate)} />
                    <Prop label="Zona (bp_zona)" value={p.bp_zona} />
                    <Prop label="Estado prospección" value={p.bp_estado_prospeccion} />
                    <Prop label="Tipo evento" value={p.bp_tipo_evento} />
                    <Prop label="Siguiente paso" value={p.hs_next_step} />
                    {p.description && (
                      <div className="prop-item" style={{ gridColumn: '1 / -1' }}>
                        <div className="prop-label">Descripción</div>
                        <div className="prop-value" style={{ whiteSpace: 'pre-wrap' }}>{p.description}</div>
                      </div>
                    )}
                  </div>
                )}

                {tab === 'actividades' && (
                  <ActivityFeed items={engData?.results} loading={loadingEng} />
                )}
              </div>
            </div>

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
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontWeight: 600, padding: '2px 6px' }}
                              onClick={() => nav(`/contacts/${c.id}`)}
                            >
                              <User size={12} style={{ marginRight: 4 }} />{name}
                            </button>
                            {cp.jobtitle && <span style={{ fontSize: 11, color: '#6b778c' }}>{cp.jobtitle}</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                            {cp.phone && (
                              <span style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Phone size={11} color="#6b778c" />{cp.phone}
                              </span>
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
          </div>

          <div className="detail-side">
            <CallWidget
              phone={activePhone}
              contactName={activeContactName}
              objectType="deals"
              objectId={id}
              onActivityLogged={() => { setTab('actividades'); qc.invalidateQueries(['engagements-deal', id]) }}
            />
          </div>
        </div>
      </div>

      {showEmail && (
        <EmailComposer
          defaultTo={defaultEmail}
          defaultSubject={`Seguimiento: ${p.dealname}`}
          emailOptions={emailOptions}
          dealId={id}
          contactId={activeContact?.id}
          onClose={() => setShowEmail(false)}
        />
      )}

      {showEdit && (
        <RecordModal
          type="deal"
          record={deal}
          onClose={() => setShowEdit(false)}
          onSaved={() => qc.invalidateQueries(['deal', id])}
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
function ActivityFeed({ items, loading }) {
  if (loading) return <div className="loading">Cargando actividades…</div>
  if (!items) return <div className="empty">Sin actividades</div>
  if (items.length === 0) return <div className="empty">Sin actividades registradas en HubSpot</div>

  const typeIcon  = { NOTE: '📝', CALL: '📞', TASK: '✅', EMAIL: '📧', MEETING: '📅' }
  const typeName  = { NOTE: 'Nota', CALL: 'Llamada', TASK: 'Tarea', EMAIL: 'Email', MEETING: 'Reunión' }
  const typeClass = { NOTE: 'activity-note', CALL: 'activity-call', TASK: 'activity-task' }

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
              {item.title && <div className="act-text" style={{ fontWeight: 500 }}>{item.title}</div>}
              {item.body && (
                <div className="act-text">{item.body.replace(/<[^>]+>/g, '').slice(0, 300)}</div>
              )}
              {item.durationMs && (
                <div className="act-meta">Duración: {Math.round(Number(item.durationMs) / 1000)}s</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
