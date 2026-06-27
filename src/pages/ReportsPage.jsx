import React, { useState } from 'react'
import { useQuery } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { X, Phone, FileText, Play, BarChart2, AlertTriangle, Calendar, CheckSquare, Users } from 'lucide-react'
import { reports, hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import { useAuth } from '../contexts/AuthContext'

const OWNER_NAMES = {
  '93615311': 'Roberto',
  '93621022': 'Yesenia',
  '93771980': 'Angel',
  '93771979': 'Gracie',
  '93771981': 'Carlos',
  '73112880': 'Sara',
}

const OWNER_IDS = ['93615311', '93621022', '93771980', '93771979', '93771981', '73112880']

const OWNER_COLORS = [
  '#4fc3f7','#81c784','#ffb74d','#f48fb1','#ce93d8','#90caf9'
]

const PERIODS = [
  { label: 'Hoy',          days: 1 },
  { label: 'Esta semana',  days: 7 },
  { label: 'Este mes',     days: 30 },
  { label: 'Ultimos 90d',  days: 90 },
]

const CALL_STATUS_LABEL = {
  COMPLETED: { text: 'Contestada',    color: '#00875a' },
  NO_ANSWER: { text: 'No contestada', color: '#de350b' },
  BUSY:      { text: 'Ocupado',       color: '#ff8b00' },
  CANCELED:  { text: 'Cancelada',     color: '#6b778c' },
  QUEUED:    { text: 'En cola',       color: '#6b778c' },
  FAILED:    { text: 'Fallida',       color: '#de350b' },
  RINGING:   { text: 'Timbrando',     color: '#ff8b00' },
  IN_PROGRESS: { text: 'En curso',    color: '#0052cc' },
}

// Limpia HTML y filtra mensajes internos de Zadarma/sistema
function cleanCallBody(raw) {
  if (!raw) return ''
  return raw
    .replace(/<[^>]+>/g, ' ')          // strip HTML tags
    .replace(/Your app hash for widget[^,]*/gi, '')
    .replace(/Ваш внутренний номер[^\n]*/gi, '')
    .replace(/Ваш пароль[^\n]*/gi, '')
    .replace(/Установить расширение[^\n]*/gi, '')
    .replace(/notas:\s*/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const safeFmt = (val) => {
  if (!val) return '—'
  const n = Number(val)
  const d = isNaN(n) || n === 0 ? new Date(val) : new Date(n)
  if (isNaN(d.getTime())) return '—'
  return format(d, 'dd MMM yyyy HH:mm', { locale: es })
}

function Avatar({ name, color }) {
  const initials = (name || 'U').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <div className="owner-avatar" style={{ background: color, color: '#0a1929' }}>
      {initials}
    </div>
  )
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ height: 4, background: '#f0f4f8', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .4s' }} />
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: '#0f2744', border: '1px solid #1a3a5c', borderRadius: 10,
        width: '100%', maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid #1a3a5c', flexShrink: 0
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e0f7fa' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b778c', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function CallsModal({ owner, days, onClose }) {
  const { data, isLoading } = useQuery(
    ['report-calls', owner.ownerId, days],
    () => reports.getCalls(owner.ownerId, days),
    { staleTime: 60_000 }
  )
  const [playing, setPlaying] = useState(null)
  const calls = data?.results || []

  return (
    <Modal title={`Llamadas — ${owner.name} (ultimos ${days} dias)`} onClose={onClose}>
      {isLoading && <div style={{ color: '#6b778c', textAlign: 'center', padding: 20 }}>Cargando llamadas…</div>}
      {!isLoading && calls.length === 0 && (
        <div style={{ color: '#6b778c', textAlign: 'center', padding: 20 }}>Sin llamadas en este periodo</div>
      )}
      {calls.map((c) => {
        const p = c.properties
        if (p.hs_call_status === 'QUEUED') return null  // ignorar llamadas en cola sin contenido
        const statusInfo = CALL_STATUS_LABEL[p.hs_call_status] || { text: p.hs_call_status || 'N/A', color: '#6b778c' }
        const durMs = Number(p.hs_call_duration || 0)
        const durSec = Math.round(durMs / 1000)
        const durStr = durSec >= 60 ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : `${durSec}s`
        const hasRecording = !!p.hs_call_recording_url
        const isExpanded = playing === c.id
        const body = cleanCallBody(p.hs_call_body)
        return (
          <div key={c.id} style={{
            marginBottom: 12, padding: 14, background: '#0a1929',
            borderRadius: 8, border: '1px solid #1a3a5c'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: statusInfo.color }}>{statusInfo.text}</span>
                {durSec > 0 && <span style={{ fontSize: 11, color: '#6b778c' }}>· {durStr}</span>}
              </div>
              <span style={{ fontSize: 11, color: '#546e7a' }}>{safeFmt(p.hs_timestamp)}</span>
            </div>
            {body && (
              <div style={{
                fontSize: 12, color: '#b0bec5', lineHeight: 1.6,
                whiteSpace: 'pre-wrap', maxHeight: isExpanded ? 'none' : 80, overflow: 'hidden',
              }}>
                {body}
              </div>
            )}
            {hasRecording && (
              <div style={{ marginTop: 10 }}>
                {isExpanded ? (
                  <audio controls src={p.hs_call_recording_url} style={{ width: '100%', height: 32 }} autoPlay />
                ) : (
                  <button
                    onClick={() => setPlaying(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: '#1a3a5c', border: 'none', borderRadius: 20,
                      padding: '4px 12px', cursor: 'pointer', color: '#4fc3f7', fontSize: 12
                    }}
                  >
                    <Play size={11} fill="#4fc3f7" /> Escuchar grabacion
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </Modal>
  )
}

function NotesModal({ owner, days, onClose }) {
  const { data, isLoading } = useQuery(
    ['report-notes', owner.ownerId, days],
    () => reports.getNotes(owner.ownerId, days),
    { staleTime: 60_000 }
  )
  const notes = data?.results || []
  return (
    <Modal title={`Notas — ${owner.name} (ultimos ${days} dias)`} onClose={onClose}>
      {isLoading && <div style={{ color: '#6b778c', textAlign: 'center', padding: 20 }}>Cargando notas…</div>}
      {!isLoading && notes.length === 0 && (
        <div style={{ color: '#6b778c', textAlign: 'center', padding: 20 }}>Sin notas en este periodo</div>
      )}
      {notes.map((n) => {
        const p = n.properties
        return (
          <div key={n.id} style={{
            marginBottom: 12, padding: 14, background: '#0a1929',
            borderRadius: 8, border: '1px solid #1a3a5c'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#00875a' }}>Nota</span>
              <span style={{ fontSize: 11, color: '#546e7a' }}>{safeFmt(p.hs_timestamp)}</span>
            </div>
            <div style={{ fontSize: 12, color: '#b0bec5', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {cleanCallBody(p.hs_note_body) || '(sin contenido)'}
            </div>
          </div>
        )
      })}
    </Modal>
  )
}

// ── Tabla comparativa por operador con una metrica ─────────────────────────────
function OwnerTable({ title, icon: Icon, iconColor, data, onClick, nav, filterFn }) {
  const max = Math.max(1, ...OWNER_IDS.map(id => data?.[id] || 0))
  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {Icon && <Icon size={14} style={{ color: iconColor }} />}
          {title}
        </h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Operador</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {OWNER_IDS.map((id, i) => {
              const count = data?.[id] || 0
              return (
                <tr key={id}
                  style={{ cursor: count > 0 && filterFn ? 'pointer' : 'default' }}
                  onClick={() => count > 0 && filterFn && nav('/deals', { state: { filter: { filters: filterFn(id) } } })}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={OWNER_NAMES[id]} color={OWNER_COLORS[i % OWNER_COLORS.length]} />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{OWNER_NAMES[id]}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: count > 0 ? iconColor || '#0052cc' : '#6b778c' }}>
                    {count}
                  </td>
                  <td style={{ minWidth: 80 }}>
                    <MiniBar value={count} max={max} color={iconColor || '#0052cc'} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState('actividad')  // 'actividad' | 'bepharma'
  const [callsModal, setCallsModal] = useState(null)
  const [notesModal, setNotesModal] = useState(null)

  if (user?.role !== 'supervisor') {
    return (
      <>
        <Topbar title="Reportes" />
        <div className="content">
          <div className="error-msg">Acceso restringido — solo supervisores.</div>
        </div>
      </>
    )
  }

  const { data: activityData, isLoading: loadingActivity } = useQuery(
    ['reports-activity', days],
    () => reports.getActivity(days),
    { staleTime: 60_000 }
  )

  const { data: chartsData } = useQuery(
    'charts',
    hubspot.charts,
    { staleTime: 120_000 }
  )

  const { data: bpData, isLoading: loadingBp } = useQuery(
    'reports-bp-summary',
    reports.getBpSummary,
    { staleTime: 5 * 60_000, enabled: tab === 'bepharma' }
  )

  const owners = activityData?.owners || []
  const maxCalls = Math.max(1, ...owners.map(o => o.calls))
  const maxNotes = Math.max(1, ...owners.map(o => o.notes))
  const maxDeals = Math.max(1, ...owners.map(o => o.activeDeals))

  const exportCSV = () => {
    const headers = ['Operador','Llamadas','Notas','Eventos activos']
    const rows = owners.map(o => [o.name, o.calls, o.notes, o.activeDeals])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bepharma-reporte-${days}d.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const goToDeals = (ownerId) => {
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }
    ]}}})
  }

  const goToStage = (stageKey) => {
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'dealstage', operator: 'EQ', value: stageKey }
    ]}}})
  }

  const goToMonth = (monthLabel) => {
    const MONTHS_ES = { Ene:0, Feb:1, Mar:2, Abr:3, May:4, Jun:5, Jul:6, Ago:7, Sep:8, Oct:9, Nov:10, Dic:11 }
    const now = new Date()
    const mIdx = MONTHS_ES[monthLabel]
    if (mIdx === undefined) return nav('/deals')
    const year = mIdx > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear()
    const start = new Date(year, mIdx, 1).toISOString()
    const end   = new Date(year, mIdx + 1, 0, 23, 59, 59).toISOString()
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'createdate', operator: 'GTE', value: start },
      { propertyName: 'createdate', operator: 'LTE', value: end },
    ]}}})
  }

  const COLORS = ['#4fc3f7','#81c784','#ffb74d','#f48fb1','#ce93d8','#90caf9','#ef9a9a']

  const nowMs = String(Date.now())
  const minus72hMs = String(Date.now() - 72 * 3600 * 1000)

  return (
    <>
      <Topbar
        title="Reportes"
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <button
                onClick={() => setTab('actividad')}
                style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: tab === 'actividad' ? 'var(--primary)' : 'transparent',
                  color: tab === 'actividad' ? '#fff' : 'var(--text-muted)' }}
              >
                Actividad
              </button>
              <button
                onClick={() => setTab('bepharma')}
                style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: tab === 'bepharma' ? 'var(--primary)' : 'transparent',
                  color: tab === 'bepharma' ? '#fff' : 'var(--text-muted)' }}
              >
                BePharma
              </button>
            </div>
            {tab === 'actividad' && (
              <>
                <div className="reports-period-selector">
                  {PERIODS.map(p => (
                    <button
                      key={p.days}
                      className={`period-btn${days === p.days ? ' active' : ''}`}
                      onClick={() => setDays(p.days)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={exportCSV}>Exportar CSV</button>
              </>
            )}
          </div>
        }
      />

      <div className="content">

        {/* ══════ TAB ACTIVIDAD ══════ */}
        {tab === 'actividad' && (
          <>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 14, fontWeight: 700 }}>Actividad del equipo — ultimos {days} dias</h2>
              <span style={{ fontSize: 11, color: '#546e7a' }}>Haz clic en los numeros para ver el detalle</span>
            </div>

            {loadingActivity ? (
              <div className="loading">Cargando datos…</div>
            ) : (
              <div className="owner-cards-grid">
                {owners.map((owner, i) => (
                  <div key={owner.ownerId} className="owner-card">
                    <div className="owner-card-header">
                      <Avatar name={owner.name} color={OWNER_COLORS[i % OWNER_COLORS.length]} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{owner.name}</div>
                        <div style={{ fontSize: 11, color: '#6b778c' }}>Operador</div>
                      </div>
                    </div>
                    <div className="owner-card-stats">
                      <div className="owner-stat" style={{ cursor: 'pointer' }} onClick={() => setCallsModal(owner)}>
                        <span className="stat-label"><Phone size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />Llamadas</span>
                        <span className="stat-val" style={{ color: '#0052cc', textDecoration: 'underline' }}>{owner.calls}</span>
                      </div>
                      <MiniBar value={owner.calls} max={maxCalls} color="#0052cc" />
                      <div className="owner-stat" style={{ marginTop: 6, cursor: 'pointer' }} onClick={() => setNotesModal(owner)}>
                        <span className="stat-label"><FileText size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />Notas</span>
                        <span className="stat-val" style={{ color: '#00875a', textDecoration: 'underline' }}>{owner.notes}</span>
                      </div>
                      <MiniBar value={owner.notes} max={maxNotes} color="#00875a" />
                      <div className="owner-stat" style={{ marginTop: 6, cursor: 'pointer' }} onClick={() => goToDeals(owner.ownerId)}>
                        <span className="stat-label">Eventos activos</span>
                        <span className="stat-val" style={{ color: '#ff8b00', textDecoration: 'underline' }}>{owner.activeDeals}</span>
                      </div>
                      <MiniBar value={owner.activeDeals} max={maxDeals} color="#ff8b00" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Graficas */}
            {chartsData && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 8 }}>
                <div className="card">
                  <div className="card-header">
                    <h2>Eventos por etapa</h2>
                    <span style={{ fontSize: 11, color: '#546e7a' }}>clic para ver deals</span>
                  </div>
                  <div className="card-body">
                    {chartsData.byStage?.map((s, i) => {
                      const maxStage = Math.max(1, ...chartsData.byStage.map(x => x.count))
                      const pct = Math.round((s.count / maxStage) * 100)
                      return (
                        <div key={s.key} style={{ marginBottom: 10, cursor: s.count > 0 ? 'pointer' : 'default' }}
                          onClick={() => s.count > 0 && goToStage(s.key)}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ color: '#172b4d' }}>{s.label}</span>
                            <span style={{ fontWeight: 700, color: s.count > 0 ? '#0052cc' : '#6b778c' }}>{s.count}</span>
                          </div>
                          <div style={{ height: 8, background: '#f0f4f8', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 4, transition: 'width .4s' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <h2>Eventos creados por mes</h2>
                    <span style={{ fontSize: 11, color: '#546e7a' }}>clic para ver eventos</span>
                  </div>
                  <div className="card-body">
                    {chartsData.byMonth && (() => {
                      const maxM = Math.max(1, ...chartsData.byMonth.map(m => m.count))
                      const H = 120
                      return (
                        <svg viewBox={`0 0 ${chartsData.byMonth.length * 50} ${H + 30}`} style={{ width: '100%' }}>
                          {chartsData.byMonth.map((m, i) => {
                            const bh = maxM > 0 ? Math.round((m.count / maxM) * H) : 0
                            const x = i * 50 + 5
                            return (
                              <g key={i} style={{ cursor: m.count > 0 ? 'pointer' : 'default' }}
                                onClick={() => m.count > 0 && goToMonth(m.label)}>
                                <rect x={x} y={H - bh} width={38} height={bh} fill="#0052cc" rx={3} opacity={.85} />
                                <text x={x + 19} y={H + 14} textAnchor="middle" fontSize={10} fill="#6b778c">{m.label}</text>
                                {m.count > 0 && (
                                  <text x={x + 19} y={H - bh - 4} textAnchor="middle" fontSize={10} fill="#172b4d" fontWeight="700">{m.count}</text>
                                )}
                              </g>
                            )
                          })}
                        </svg>
                      )
                    })()}
                  </div>
                </div>
              </div>
            )}

            {owners.length > 0 && (
              <div className="card" style={{ marginTop: 20 }}>
                <div className="card-header"><h2>Resumen comparativo del equipo</h2></div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Operador</th>
                        <th>Llamadas</th>
                        <th>Notas</th>
                        <th>Eventos activos</th>
                        <th>Actividad total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...owners].sort((a, b) => (b.calls + b.notes) - (a.calls + a.notes)).map((owner, i) => {
                        const total = owner.calls + owner.notes
                        const maxTotal = Math.max(1, ...owners.map(o => o.calls + o.notes))
                        return (
                          <tr key={owner.ownerId}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Avatar name={owner.name} color={OWNER_COLORS[i % OWNER_COLORS.length]} />
                                <span style={{ fontWeight: 600 }}>{owner.name}</span>
                              </div>
                            </td>
                            <td style={{ fontWeight: 700, color: '#0052cc', cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={() => setCallsModal(owner)}>{owner.calls}</td>
                            <td style={{ fontWeight: 700, color: '#00875a', cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={() => setNotesModal(owner)}>{owner.notes}</td>
                            <td style={{ fontWeight: 700, color: '#ff8b00', cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={() => goToDeals(owner.ownerId)}>{owner.activeDeals}</td>
                            <td style={{ minWidth: 120 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 700, minWidth: 24 }}>{total}</span>
                                <div style={{ flex: 1, height: 6, background: '#f0f4f8', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.round((total / maxTotal) * 100)}%`, height: '100%', background: '#0052cc', borderRadius: 3 }} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════ TAB BEPHARMA ══════ */}
        {tab === 'bepharma' && (
          <>
            {loadingBp ? (
              <div className="loading">Cargando reportes BePharma…</div>
            ) : !bpData ? (
              <div className="error-msg">No se pudieron cargar los datos.</div>
            ) : (
              <>
                {/* Resumen global */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                  {[
                    { label: 'Nuevos este mes',  value: bpData.nuevosEsteMes,  color: '#0052cc', icon: Users },
                    { label: 'Callbacks vencidos', value: Object.values(bpData.callbacksVencidosPorOwner || {}).reduce((a,b) => a+b, 0), color: '#de350b', icon: Calendar },
                    { label: 'Sin actividad +72h', value: Object.values(bpData.sinActividad72hPorOwner || {}).reduce((a,b) => a+b, 0), color: '#ff8b00', icon: AlertTriangle },
                    { label: 'Confirmadas', value: Object.values(bpData.confirmadasPorOwner || {}).reduce((a,b) => a+b, 0), color: '#00875a', icon: CheckSquare },
                    { label: 'Participa otro evento', value: Object.values(bpData.participaOtroPorOwner || {}).reduce((a,b) => a+b, 0), color: '#7c3aed', icon: BarChart2 },
                  ].map(({ label, value, color, icon: Icon }) => (
                    <div key={label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 18px', minWidth: 140, textAlign: 'center' }}>
                      <Icon size={16} style={{ color, marginBottom: 4 }} />
                      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value ?? '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Distribucion por estado de prospeccion */}
                {bpData.porEstadoProspeccion && (
                  <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header">
                      <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <BarChart2 size={14} style={{ color: '#0052cc' }} />
                        Distribucion por estado de prospeccion
                      </h2>
                    </div>
                    <div className="card-body">
                      {Object.entries(bpData.porEstadoProspeccion).map(([estado, count], i) => {
                        const maxEstado = Math.max(1, ...Object.values(bpData.porEstadoProspeccion))
                        const pct = Math.round((count / maxEstado) * 100)
                        return (
                          <div key={estado} style={{ marginBottom: 10, cursor: count > 0 ? 'pointer' : 'default' }}
                            onClick={() => count > 0 && nav('/deals', { state: { filter: { filters: [
                              { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
                              { propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: estado },
                            ]}}})}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                              <span>{estado}</span>
                              <span style={{ fontWeight: 700, color: count > 0 ? '#0052cc' : '#6b778c' }}>{count}</span>
                            </div>
                            <div style={{ height: 8, background: '#f0f4f8', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 4, transition: 'width .4s' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Tablas por operador */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <OwnerTable
                    title="Callbacks vencidos por operador"
                    icon={Calendar} iconColor="#de350b"
                    data={bpData.callbacksVencidosPorOwner}
                    nav={nav}
                    filterFn={(ownerId) => [
                      { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
                      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
                      { propertyName: 'bp_proximo_contacto', operator: 'LT', value: nowMs },
                      { propertyName: 'dealstage', operator: 'NEQ', value: 'confirmada_bepharma' },
                      { propertyName: 'dealstage', operator: 'NEQ', value: 'no_participa' },
                    ]}
                  />
                  <OwnerTable
                    title="Sin actividad +72h por operador"
                    icon={AlertTriangle} iconColor="#ff8b00"
                    data={bpData.sinActividad72hPorOwner}
                    nav={nav}
                    filterFn={(ownerId) => [
                      { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
                      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
                      { propertyName: 'bp_ultima_actividad_operador', operator: 'LT', value: minus72hMs },
                      { propertyName: 'dealstage', operator: 'NEQ', value: 'confirmada_bepharma' },
                      { propertyName: 'dealstage', operator: 'NEQ', value: 'no_participa' },
                    ]}
                  />
                  <OwnerTable
                    title="Confirmadas BePharma por operador"
                    icon={CheckSquare} iconColor="#00875a"
                    data={bpData.confirmadasPorOwner}
                    nav={nav}
                    filterFn={(ownerId) => [
                      { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
                      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
                      { propertyName: 'dealstage', operator: 'EQ', value: 'confirmada_bepharma' },
                    ]}
                  />
                  <OwnerTable
                    title="Participa otro evento por operador"
                    icon={BarChart2} iconColor="#7c3aed"
                    data={bpData.participaOtroPorOwner}
                    nav={nav}
                    filterFn={(ownerId) => [
                      { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
                      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
                      { propertyName: 'bp_decision_participacion', operator: 'EQ', value: 'participa_otro_evento' },
                    ]}
                  />
                  <OwnerTable
                    title="Tareas abiertas por operador"
                    icon={CheckSquare} iconColor="#546e7a"
                    data={bpData.tareasPorOwner}
                    nav={nav}
                    filterFn={null}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>

      {callsModal && <CallsModal owner={callsModal} days={days} onClose={() => setCallsModal(null)} />}
      {notesModal && <NotesModal owner={notesModal} days={days} onClose={() => setNotesModal(null)} />}
    </>
  )
}
