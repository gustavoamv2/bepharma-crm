import React, { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from 'react-query'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ExternalLink, Mail, Pencil } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
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

export default function DealDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab]             = useState('info')
  const [showEmail, setShowEmail] = useState(false)
  const [showEdit, setShowEdit]   = useState(false)
  const [showTask, setShowTask]   = useState(false)

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

            {contacts.length > 0 && (
              <div className="card">
                <div className="card-header"><h2>Contactos ({contacts.length})</h2></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {contacts.map(c => (
                    <button key={c.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start' }}
                      onClick={() => nav(`/contacts/${c.id}`)}>
                      👤 Contacto #{c.id}
                    </button>
                  ))}
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
              contactName={p.dealname}
              objectType="deals"
              objectId={id}
              onActivityLogged={() => qc.invalidateQueries(['engagements-deal', id])}
            />
          </div>
        </div>
      </div>

      {showEmail && (
        <EmailComposer
          defaultSubject={`Seguimiento: ${p.dealname}`}
          dealId={id}
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
        onActivityLogged={() => qc.invalidateQueries(['engagements-deal', id])}
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
