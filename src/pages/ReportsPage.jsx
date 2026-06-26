import React, { useState } from 'react'
import { useQuery } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { X, Phone, FileText, Play } from 'lucide-react'
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

const OWNER_COLORS = [
  '#4fc3f7','#81c784','#ffb74d','#f48fb1','#ce93d8','#90caf9'
]

const PERIODS = [
  { label: 'Hoy',          days: 1 },
  { label: 'Esta semana',  days: 7 },
  { label: 'Este mes',     days: 30 },
  { label: 'Últimos 90d',  days: 90 },
]

const CALL_STATUS_LABEL = {
  COMPLETED: { text: '✅ Contestada', color: '#00875a' },
  NO_ANSWER: { text: '❌ No contestada', color: '#de350b' },
  BUSY:      { text: '🔴 Ocupado',        color: '#ff8b00' },
  CANCELED:  { text: '⚪ Cancelada',      color: '#6b778c' },
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

// ── Modal genérico ─────────────────────────────────────────────────────────────
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

// ── Modal de llamadas ──────────────────────────────────────────────────────────
function CallsModal({ owner, days, onClose }) {
  const { data, isLoading } = useQuery(
    ['report-calls', owner.ownerId, days],
    () => reports.getCalls(owner.ownerId, days),
    { staleTime: 60_000 }
  )
  const [playing, setPlaying] = useState(null)

  const calls = data?.results || []

  return (
    <Modal title={`📞 Llamadas — ${owner.name} (últimos ${days} días)`} onClose={onClose}>
      {isLoading && <div style={{ color: '#6b778c', textAlign: 'center', padding: 20 }}>Cargando llamadas…</div>}
      {!isLoading && calls.length === 0 && (
        <div style={{ color: '#6b778c', textAlign: 'center', padding: 20 }}>Sin llamadas en este período</div>
      )}
      {calls.map((c, i) => {
        const p = c.properties
        const statusInfo = CALL_STATUS_LABEL[p.hs_call_status] || { text: p.hs_call_status || 'N/A', color: '#6b778c' }
        const durMs = Number(p.hs_call_duration || 0)
        const durSec = Math.round(durMs / 1000)
        const durStr = durSec >= 60 ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : `${durSec}s`
        const hasRecording = !!p.hs_call_recording_url
        const isExpanded = playing === c.id

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

            {p.hs_call_body && (
              <div style={{
                fontSize: 12, color: '#b0bec5', lineHeight: 1.6,
                whiteSpace: 'pre-wrap', maxHeight: isExpanded ? 'none' : 80, overflow: 'hidden',
                position: 'relative'
              }}>
                {p.hs_call_body}
              </div>
            )}

            {hasRecording && (
              <div style={{ marginTop: 10 }}>
                {isExpanded ? (
                  <audio
                    controls
                    src={p.hs_call_recording_url}
                    style={{ width: '100%', height: 32 }}
                    autoPlay
                  />
                ) : (
                  <button
                    onClick={() => setPlaying(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: '#1a3a5c', border: 'none', borderRadius: 20,
                      padding: '4px 12px', cursor: 'pointer', color: '#4fc3f7', fontSize: 12
                    }}
                  >
                    <Play size={11} fill="#4fc3f7" /> Escuchar grabación
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

// ── Modal de notas ─────────────────────────────────────────────────────────────
function NotesModal({ owner, days, onClose }) {
  const { data, isLoading } = useQuery(
    ['report-notes', owner.ownerId, days],
    () => reports.getNotes(owner.ownerId, days),
    { staleTime: 60_000 }
  )

  const notes = data?.results || []

  return (
    <Modal title={`📝 Notas — ${owner.name} (últimos ${days} días)`} onClose={onClose}>
      {isLoading && <div style={{ color: '#6b778c', textAlign: 'center', padding: 20 }}>Cargando notas…</div>}
      {!isLoading && notes.length === 0 && (
        <div style={{ color: '#6b778c', textAlign: 'center', padding: 20 }}>Sin notas en este período</div>
      )}
      {notes.map((n) => {
        const p = n.properties
        return (
          <div key={n.id} style={{
            marginBottom: 12, padding: 14, background: '#0a1929',
            borderRadius: 8, border: '1px solid #1a3a5c'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#00875a' }}>📝 Nota</span>
              <span style={{ fontSize: 11, color: '#546e7a' }}>{safeFmt(p.hs_timestamp)}</span>
            </div>
            <div style={{ fontSize: 12, color: '#b0bec5', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {p.hs_note_body
                ? p.hs_note_body.replace(/<[^>]+>/g, '').trim() || '(sin contenido)'
                : '(sin contenido)'}
            </div>
          </div>
        )
      })}
    </Modal>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [days, setDays] = useState(30)
  const [callsModal, setCallsModal]  = useState(null) // { owner }
  const [notesModal, setNotesModal]  = useState(null) // { owner }

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

  const { data: chartsData, isLoading: loadingCharts } = useQuery(
    'charts',
    hubspot.charts,
    { staleTime: 120_000 }
  )

  const owners = activityData?.owners || []
  const maxCalls  = Math.max(1, ...owners.map(o => o.calls))
  const maxNotes  = Math.max(1, ...owners.map(o => o.notes))
  const maxDeals  = Math.max(1, ...owners.map(o => o.activeDeals))

  // CSV export
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

  // Navegar a /deals con filtro de dueño
  const goToDeals = (ownerId) => {
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }
    ]}}})
  }

  // Navegar a /deals filtrado por etapa
  const goToStage = (stageKey) => {
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'dealstage', operator: 'EQ', value: stageKey }
    ]}}})
  }

  // Navegar a /deals filtrado por mes de creación
  const goToMonth = (monthLabel) => {
    // monthLabel is like "Ene", "Feb" — derive date range from current year
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

  const isLoading = loadingActivity || loadingCharts
  const COLORS = ['#4fc3f7','#81c784','#ffb74d','#f48fb1','#ce93d8','#90caf9','#ef9a9a']

  return (
    <>
      <Topbar
        title="Reportes de productividad"
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
              ⬇ CSV
            </button>
          </div>
        }
      />

      <div className="content">

        {/* ── Resumen por operador ── */}
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700 }}>Actividad del equipo — últimos {days} días</h2>
          <span style={{ fontSize: 11, color: '#546e7a' }}>Haz clic en los números para ver el detalle</span>
        </div>

        {isLoading ? (
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
                  {/* Llamadas — clic abre modal */}
                  <div
                    className="owner-stat"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setCallsModal(owner)}
                    title="Ver historial de llamadas"
                  >
                    <span className="stat-label">📞 Llamadas</span>
                    <span className="stat-val" style={{ color: '#0052cc', textDecoration: 'underline' }}>
                      {owner.calls}
                    </span>
                  </div>
                  <MiniBar value={owner.calls} max={maxCalls} color="#0052cc" />

                  {/* Notas — clic abre modal */}
                  <div
                    className="owner-stat"
                    style={{ marginTop: 6, cursor: 'pointer' }}
                    onClick={() => setNotesModal(owner)}
                    title="Ver notas"
                  >
                    <span className="stat-label">📝 Notas</span>
                    <span className="stat-val" style={{ color: '#00875a', textDecoration: 'underline' }}>
                      {owner.notes}
                    </span>
                  </div>
                  <MiniBar value={owner.notes} max={maxNotes} color="#00875a" />

                  {/* Eventos activos — clic navega a /deals filtrado */}
                  <div
                    className="owner-stat"
                    style={{ marginTop: 6, cursor: 'pointer' }}
                    onClick={() => goToDeals(owner.ownerId)}
                    title="Ver eventos activos de este operador"
                  >
                    <span className="stat-label">💼 Eventos activos</span>
                    <span className="stat-val" style={{ color: '#ff8b00', textDecoration: 'underline' }}>
                      {owner.activeDeals}
                    </span>
                  </div>
                  <MiniBar value={owner.activeDeals} max={maxDeals} color="#ff8b00" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Gráficas clicables ── */}
        {chartsData && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 8 }}>

            {/* Deals por etapa — barras clicables */}
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
                    <div
                      key={s.key}
                      style={{ marginBottom: 10, cursor: s.count > 0 ? 'pointer' : 'default' }}
                      onClick={() => s.count > 0 && goToStage(s.key)}
                      title={s.count > 0 ? `Ver ${s.count} deals en ${s.label}` : ''}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: '#172b4d' }}>{s.label}</span>
                        <span style={{ fontWeight: 700, color: s.count > 0 ? '#0052cc' : '#6b778c' }}>{s.count}</span>
                      </div>
                      <div style={{ height: 8, background: '#f0f4f8', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%',
                          background: COLORS[i % COLORS.length],
                          borderRadius: 4, transition: 'width .4s'
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Deals por mes — barras clicables */}
            <div className="card">
              <div className="card-header">
                <h2>Eventos creados por mes</h2>
                <span style={{ fontSize: 11, color: '#546e7a' }}>clic para ver deals</span>
              </div>
              <div className="card-body">
                {chartsData.byMonth && (() => {
                  const maxM = Math.max(1, ...chartsData.byMonth.map(m => m.count))
                  const H = 120
                  return (
                    <div>
                      <svg viewBox={`0 0 ${chartsData.byMonth.length * 50} ${H + 30}`} style={{ width: '100%' }}>
                        {chartsData.byMonth.map((m, i) => {
                          const bh = maxM > 0 ? Math.round((m.count / maxM) * H) : 0
                          const x = i * 50 + 5
                          return (
                            <g
                              key={i}
                              style={{ cursor: m.count > 0 ? 'pointer' : 'default' }}
                              onClick={() => m.count > 0 && goToMonth(m.label)}
                            >
                              <rect x={x} y={H - bh} width={38} height={bh} fill="#0052cc" rx={3} opacity={.85} />
                              <text x={x + 19} y={H + 14} textAnchor="middle" fontSize={10} fill="#6b778c">{m.label}</text>
                              {m.count > 0 && (
                                <text x={x + 19} y={H - bh - 4} textAnchor="middle" fontSize={10} fill="#172b4d" fontWeight="700">{m.count}</text>
                              )}
                            </g>
                          )
                        })}
                      </svg>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── Tabla resumen del equipo ── */}
        {owners.length > 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header">
              <h2>Resumen comparativo del equipo</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operador</th>
                    <th>📞 Llamadas</th>
                    <th>📝 Notas</th>
                    <th>💼 Eventos activos</th>
                    <th>Actividad total</th>
                  </tr>
                </thead>
                <tbody>
                  {owners
                    .sort((a, b) => (b.calls + b.notes) - (a.calls + a.notes))
                    .map((owner, i) => {
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
                          <td
                            style={{ fontWeight: 700, color: '#0052cc', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => setCallsModal(owner)}
                            title="Ver llamadas"
                          >
                            {owner.calls}
                          </td>
                          <td
                            style={{ fontWeight: 700, color: '#00875a', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => setNotesModal(owner)}
                            title="Ver notas"
                          >
                            {owner.notes}
                          </td>
                          <td
                            style={{ fontWeight: 700, color: '#ff8b00', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => goToDeals(owner.ownerId)}
                            title="Ver eventos activos"
                          >
                            {owner.activeDeals}
                          </td>
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

      </div>

      {/* Modales */}
      {callsModal && (
        <CallsModal owner={callsModal} days={days} onClose={() => setCallsModal(null)} />
      )}
      {notesModal && (
        <NotesModal owner={notesModal} days={days} onClose={() => setNotesModal(null)} />
      )}
    </>
  )
}
