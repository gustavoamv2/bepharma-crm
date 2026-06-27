import React, { useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from 'react-query'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ExternalLink, Mail, Pencil } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import CallWidget from '../components/CallWidget'
import EmailComposer from '../components/EmailComposer'
import RecordModal, { DeleteButton } from '../components/RecordModal'
import ActivityBar from '../components/ActivityBar'
import CreateTaskModal from '../components/CreateTaskModal'

const COMPANY_STAGES = [
  { key: 'nueva',           label: '🆕 Nueva' },
  { key: 'depuracion',      label: '🧹 Depuración' },
  { key: 'enriquecimiento', label: '💎 Enriquecimiento' },
  { key: 'calificada',      label: '✅ Calificada' },
  { key: 'contactada',      label: '📞 Contactada' },
  { key: 'seguimiento',     label: '🔁 Seguimiento' },
  { key: 'confirmada',      label: '🏆 Confirmada' },
  { key: 'descartada',      label: '❌ Descartada' },
]

function StageSelector({ companyId, currentStage, onUpdated }) {
  const [saving, setSaving] = useState(false)
  const [value, setValue] = useState(currentStage || '')
  const [errorMsg, setErrorMsg] = useState(null)

  const handleChange = async (e) => {
    const newStage = e.target.value
    setValue(newStage)
    setSaving(true)
    setErrorMsg(null)
    try {
      await hubspot.updateCompany(companyId, { bp_etapa_empresa: newStage })
      onUpdated?.()
    } catch (err) {
      const d = err.response?.data
      const msg = d?.message || d?.error || err.message || 'Error al guardar'
      setErrorMsg(msg)
      setValue(currentStage || '')
    } finally {
      setSaving(false)
    }
  }

  const current = COMPANY_STAGES.find(s => s.key === value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select
          value={value}
          onChange={handleChange}
          disabled={saving}
          style={{
            padding: '5px 10px', borderRadius: 6, border: '1px solid #dfe1e6',
            background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            color: '#172b4d', outline: 'none'
          }}
        >
          <option value="">— Sin etapa —</option>
          {COMPANY_STAGES.map(s => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        {saving && <span style={{ fontSize: 11, color: '#6b778c' }}>Guardando…</span>}
      </div>
      {errorMsg && <div style={{ fontSize: 11, color: '#b91c1c' }}>{errorMsg}</div>}
    </div>
  )
}

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

export default function CompanyDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [showEmail, setShowEmail] = useState(false)
  const [showEdit, setShowEdit]   = useState(false)
  const [showTask, setShowTask]   = useState(false)

  const { data: company, isLoading, error } = useQuery(['company', id], () => hubspot.getCompany(id))

  if (isLoading) return <><Topbar title="Empresa" back /><div className="content"><div className="loading">Cargando…</div></div></>
  if (error) return <><Topbar title="Empresa" back /><div className="content"><div className="error-msg">{typeof error.message === 'string' ? error.message : 'Error al cargar la empresa'}</div></div></>
  if (!company?.properties) return <><Topbar title="Empresa" back /><div className="content"><div className="error-msg">No se pudo cargar la empresa (ID: {id})</div></div></>

  const p = company.properties
  const contacts = company.associations?.contacts?.results || []
  const deals = company.associations?.deals?.results || []
  const portalId = '51580878'

  return (
    <>
      <Topbar title={p.name || 'Empresa'} back />
      <div className="content">
        <div className="breadcrumb">
          <Link to="/companies">Empresas</Link>
          <span>/</span>
          <span>{p.name}</span>
          <a href={`https://app.hubspot.com/contacts/${portalId}/company/${id}`} target="_blank" rel="noopener" style={{ marginLeft: 8 }}>
            <ExternalLink size={12} />
          </a>
        </div>

        <div className="detail-grid">
          <div className="detail-main">
            <div className="card">
              <div className="card-header">
                <h2>{p.name}</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowEmail(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Mail size={13} /> Email
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Pencil size={13} /> Editar
                  </button>
                  <DeleteButton type="company" id={id} name={p.name} onDeleted={() => nav('/companies')} />
                </div>
              </div>
              <div className="card-body">
                {/* Selector de etapa BePharma */}
                <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f4f5f7', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6b778c', whiteSpace: 'nowrap' }}>Etapa BePharma:</span>
                  <StageSelector
                    companyId={id}
                    currentStage={p.bp_etapa_empresa}
                    onUpdated={() => qc.invalidateQueries(['company', id])}
                  />
                </div>
                <div className="props-grid">
                  <Prop label="Dominio" value={p.domain} />
                  <Prop label="Teléfono" value={p.phone} />
                  <Prop label="Ciudad" value={p.city} />
                  <Prop label="País" value={p.country} />
                  <Prop label="Industria" value={p.industry} />
                  <Prop label="Empleados" value={p.numberofemployees} />
                  <Prop label="Ingresos anuales" value={p.annualrevenue ? `$${Number(p.annualrevenue).toLocaleString('es-MX')}` : null} />
                  <Prop label="Lifecycle stage" value={p.lifecyclestage} />
                  <Prop label="Creada" value={safeFmt(p.createdate)} />
                  {p.description && (
                    <div className="prop-item" style={{ gridColumn: '1 / -1' }}>
                      <div className="prop-label">Descripción</div>
                      <div className="prop-value" style={{ whiteSpace: 'pre-wrap' }}>{p.description}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {contacts.length > 0 && (
              <div className="card">
                <div className="card-header"><h2>Contactos ({contacts.length})</h2></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {contacts.map(c => {
                    const cp = c.properties || {}
                    const name = [cp.firstname, cp.lastname].filter(Boolean).join(' ') || `Contacto #${c.id}`
                    return (
                      <button key={c.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: 8 }}
                        onClick={() => nav(`/contacts/${c.id}`)}>
                        👤 <strong>{name}</strong>
                        {cp.jobtitle && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{cp.jobtitle}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {deals.length > 0 && (
              <div className="card">
                <div className="card-header"><h2>Eventos ({deals.length})</h2></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {deals.map(d => {
                    const dp = d.properties || {}
                    const STAGE_LABELS = {
                      appointmentscheduled: 'Cita agendada', qualifiedtobuy: 'Calificado',
                      presentationscheduled: 'Presentación', decisionmakerboughtin: 'DM Aprobó',
                      contractsent: 'Contrato', closedwon: '✅ Ganado', closedlost: '❌ Perdido'
                    }
                    return (
                      <button key={d.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: 8 }}
                        onClick={() => nav(`/deals/${d.id}`)}>
                        💼 <strong>{dp.dealname || `Evento #${d.id}`}</strong>
                        {dp.dealstage && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                            {STAGE_LABELS[dp.dealstage] || dp.dealstage}
                          </span>
                        )}
                        {dp.amount && (
                          <span style={{ fontSize: 11, color: 'var(--success)', marginLeft: 'auto' }}>
                            ${Number(dp.amount).toLocaleString('es-MX')}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="detail-side">
            <CallWidget
              phone={p.phone}
              contactName={p.name}
              objectType="companies"
              objectId={id}
              onActivityLogged={() => qc.invalidateQueries(['engagements-company', id])}
            />
          </div>
        </div>
      </div>

      {showEmail && (
        <EmailComposer
          defaultSubject={`Contacto BePharma — ${p.name}`}
          companyId={id}
          onClose={() => setShowEmail(false)}
        />
      )}

      {showEdit && (
        <RecordModal
          type="company"
          record={company}
          onClose={() => setShowEdit(false)}
          onSaved={() => qc.invalidateQueries(['company', id])}
        />
      )}

      {showTask && (
        <CreateTaskModal
          onClose={() => setShowTask(false)}
          associatedObjectType="companies"
          associatedObjectId={id}
          associatedObjectName={p.name}
        />
      )}

      <ActivityBar
        objectType="companies"
        objectId={id}
        objectName={p.name}
        onActivityLogged={() => qc.invalidateQueries(['engagements-company', id])}
      />
    </>
  )
}
