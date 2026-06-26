import React, { useState } from 'react'
import { useQuery } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, TrendingUp, Calendar, PhoneCall, CheckSquare, Users, Clock, BarChart2, Eye } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { hubspot } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import { useAuth } from '../contexts/AuthContext'

// ── Gráfica de barras SVG (interactiva) ──────────────────────────────────────
function BarChart({ data, color = '#4fc3f7', height = 140, onBarClick }) {
  if (!data?.length) return null
  const max = Math.max(...data.map(d => d.count), 1)
  const W = 340, H = height, PL = 8, PR = 8, PT = 20, PB = 32
  const cW = W - PL - PR
  const cH = H - PT - PB
  const slot = cW / data.length
  const bW = Math.min(slot * 0.65, 36)
  const [hovered, setHovered] = useState(null)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }}>
      {[0.25, 0.5, 0.75, 1].map(p => {
        const y = PT + cH * (1 - p)
        return <line key={p} x1={PL} y1={y} x2={W - PR} y2={y} stroke="#e2e8f0" strokeWidth={1} />
      })}
      {data.map((d, i) => {
        const bH = Math.max((d.count / max) * cH, d.count > 0 ? 4 : 0)
        const x = PL + i * slot + (slot - bW) / 2
        const y = PT + cH - bH
        const isHovered = hovered === i
        return (
          <g key={i}
            style={{ cursor: onBarClick && d.count > 0 ? 'pointer' : 'default' }}
            onClick={() => d.count > 0 && onBarClick?.(d)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <rect x={x} y={y} width={bW} height={bH} rx={3}
              fill={isHovered ? '#0041a8' : color}
              opacity={isHovered ? 1 : 0.85}
              style={{ transition: 'fill .1s' }}
            />
            {d.count > 0 && (
              <text x={x + bW / 2} y={y - 4} textAnchor="middle" fontSize={10} fontWeight="600" fill={color}>{d.count}</text>
            )}
            <text x={x + bW / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#6b778c">
              {d.label?.length > 8 ? d.label.slice(0, 7) + '…' : d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Gráfica donut SVG (interactiva) ──────────────────────────────────────────
const STAGE_COLORS = {
  appointmentscheduled:  '#4fc3f7',
  qualifiedtobuy:        '#29b6f6',
  presentationscheduled: '#ff9800',
  decisionmakerboughtin: '#ab47bc',
  contractsent:          '#42a5f5',
  closedwon:             '#66bb6a',
  closedlost:            '#ef5350',
}
const STAGE_LABELS = {
  appointmentscheduled:  'Agendada',
  qualifiedtobuy:        'Calificado',
  presentationscheduled: 'Presentación',
  decisionmakerboughtin: 'DM Aprobó',
  contractsent:          'Contrato',
  closedwon:             'Ganado',
  closedlost:            'Perdido',
}

function DonutChart({ data, onSliceClick }) {
  const [hovered, setHovered] = useState(null)
  if (!data?.length) return null
  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return <div style={{ fontSize: 12, color: '#6b778c', padding: 20, textAlign: 'center' }}>Sin datos</div>

  const R = 48, cx = 64, cy = 64, strokeW = 22
  let angle = -90

  const slices = data
    .filter(d => d.count > 0)
    .map(d => {
      const start = angle
      const sweep = (d.count / total) * 360
      angle += sweep
      return { ...d, start, sweep }
    })

  const arcPath = (cx, cy, R, start, sweep) => {
    const r = (a) => (a * Math.PI) / 180
    const x1 = cx + R * Math.cos(r(start))
    const y1 = cy + R * Math.sin(r(start))
    const x2 = cx + R * Math.cos(r(start + sweep))
    const y2 = cy + R * Math.sin(r(start + sweep))
    return `M ${x1} ${y1} A ${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <svg viewBox="0 0 128 128" style={{ width: 128, height: 128, flexShrink: 0 }}>
        {slices.map((s, i) => (
          <path key={i}
            d={arcPath(cx, cy, R, s.start, s.sweep)}
            fill="none"
            stroke={STAGE_COLORS[s.key] || '#607d8b'}
            strokeWidth={hovered === i ? strokeW + 4 : strokeW}
            strokeLinecap="butt"
            style={{ cursor: onSliceClick ? 'pointer' : 'default', transition: 'stroke-width .1s' }}
            onClick={() => onSliceClick?.(s)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={18} fontWeight="700" fill="#172b4d">{total}</text>
        <text x={cx} y={cx + 10} textAnchor="middle" fontSize={9} fill="#6b778c">eventos</text>
      </svg>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {slices.map((s, i) => (
          <div key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
              cursor: onSliceClick ? 'pointer' : 'default',
              opacity: hovered === null || hovered === i ? 1 : 0.5,
              transition: 'opacity .1s'
            }}
            onClick={() => onSliceClick?.(s)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div style={{ width: 10, height: 10, borderRadius: 2, background: STAGE_COLORS[s.key] || '#607d8b', flexShrink: 0 }} />
            <span style={{ color: '#6b778c', flex: 1 }}>{STAGE_LABELS[s.key] || s.label}</span>
            <span style={{ fontWeight: 600, color: '#172b4d' }}>{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const now = () => new Date().toISOString()
const minus72h = () => new Date(Date.now() - 72 * 3600 * 1000).toISOString()
const startMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

const safeFmt = (val) => {
  if (!val) return '—'
  const n = Number(val)
  const d = isNaN(n) || n === 0 ? new Date(val) : new Date(n)
  if (isNaN(d.getTime())) return '—'
  return format(d, 'dd MMM HH:mm', { locale: es })
}

const PRIORITY_BADGE = {
  HIGH:   { label: 'Alta',  cls: 'badge-red' },
  MEDIUM: { label: 'Media', cls: 'badge-yellow' },
  LOW:    { label: 'Baja',  cls: 'badge-gray' },
}

const ASSOC_PATHS = { deals: '/deals', contacts: '/contacts', companies: '/companies' }

export default function Dashboard() {
  const nav = useNavigate()
  const { user } = useAuth()

  // Toggle supervisor/operador para usuarios con rol supervisor (Yesenia, Roberto)
  const [viewAsOperator, setViewAsOperator] = useState(
    () => sessionStorage.getItem('bp_view_mode') === 'operator'
  )
  const toggleView = () => {
    const next = !viewAsOperator
    setViewAsOperator(next)
    if (next) sessionStorage.setItem('bp_view_mode', 'operator')
    else sessionStorage.removeItem('bp_view_mode')
  }
  const isSupervisor = user?.role === 'supervisor' && !viewAsOperator
  const canToggle = user?.role === 'supervisor'

  const { data: metrics, isLoading: loadingMetrics, error: metricsError } = useQuery(
    ['metrics', user?.username, viewAsOperator],
    hubspot.metrics,
    { refetchInterval: 5 * 60 * 1000 }
  )

  const { data: chartsData } = useQuery(
    ['charts', user?.username, viewAsOperator],
    hubspot.charts,
    { refetchInterval: 10 * 60 * 1000 }
  )

  const { data: pipelineData } = useQuery(
    ['company-pipeline'],
    hubspot.getCompanyPipeline,
    { refetchInterval: 10 * 60 * 1000 }
  )

  const { data: tasksData, isLoading: loadingTasks } = useQuery(
    ['tasks-pending', user?.username, viewAsOperator],
    hubspot.getPendingTasks,
    { refetchInterval: 3 * 60 * 1000 }
  )

  const tasks = tasksData?.results || []

  // ── Company pipeline ───────────────────────────────────────────────────────
  const PIPELINE_STAGES = [
    { key: 'nueva',           label: '🆕 Nueva' },
    { key: 'depuracion',      label: '🧹 Depuración' },
    { key: 'enriquecimiento', label: '💎 Enriquecimiento' },
    { key: 'calificada',      label: '✅ Calificada' },
    { key: 'contactada',      label: '📞 Contactada' },
    { key: 'seguimiento',     label: '🔁 Seguimiento' },
    { key: 'confirmada',      label: '🏆 Confirmada' },
    { key: 'descartada',      label: '❌ Descartada' },
  ]
  const companyStages = pipelineData?.byStage
    ? PIPELINE_STAGES.map(s => ({ ...s, count: pipelineData.byStage[s.key] || 0 }))
    : null

  // ── Métricas cards ─────────────────────────────────────────────────────────
  const metricCards = [
    {
      key: 'sinActividad72h',
      label: isSupervisor ? 'Sin actividad +72h' : 'Mis deals sin actividad',
      sublabel: isSupervisor ? 'Todo el equipo' : '+72h sin tocar',
      icon: AlertTriangle, cls: 'metric-danger',
      filter: { filters: [
        { propertyName: 'hs_lastmodifieddate', operator: 'LT', value: minus72h() },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' }
      ]}
    },
    {
      key: 'callbacksVencidos',
      label: isSupervisor ? 'Callbacks vencidos' : 'Mis callbacks vencidos',
      sublabel: 'Fecha cierre pasada',
      icon: PhoneCall, cls: 'metric-danger',
      filter: { filters: [
        { propertyName: 'closedate', operator: 'LT', value: now() },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' }
      ]}
    },
    {
      key: 'sinProximoContacto',
      label: 'Sin próx. contacto',
      sublabel: 'Sin siguiente paso',
      icon: Calendar, cls: 'metric-warning',
      filter: { filters: [
        { propertyName: 'notes_next_activity_date', operator: 'NOT_HAS_PROPERTY' },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' }
      ]}
    },
    {
      key: 'confirmadasEsteMes',
      label: isSupervisor ? 'Confirmadas este mes' : 'Mis confirmadas',
      sublabel: 'Eventos ganados',
      icon: CheckSquare, cls: 'metric-success',
      filter: { filters: [
        { propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' },
        { propertyName: 'createdate', operator: 'GTE', value: startMonth() }
      ]}
    },
    ...(isSupervisor ? [{
      key: 'nuevosEsteMes',
      label: 'Nuevos este mes',
      sublabel: 'Todos los operadores',
      icon: TrendingUp, cls: 'metric-primary',
      filter: { filters: [
        { propertyName: 'createdate', operator: 'GTE', value: startMonth() }
      ]}
    }] : [])
  ]

  // ── Accesos rápidos ────────────────────────────────────────────────────────
  const quickLinks = isSupervisor ? [
    { label: '📋 Todos los eventos activos', path: '/deals' },
    { label: '✅ Eventos ganados',           path: '/deals', stageFilter: 'closedwon' },
    { label: '📊 Pipeline Kanban',            path: '/kanban' },
    { label: '🏢 Todas las empresas',         path: '/companies' },
    { label: '📈 Reportes del equipo',        path: '/reports' },
    { label: '🔍 Buscar en Apollo / RR',      path: '/search' },
  ] : [
    { label: '📋 Mis eventos activos',       path: '/deals' },
    { label: '📊 Pipeline Kanban',            path: '/kanban' },
    { label: '🔴 Mis callbacks vencidos',     path: '/deals', stageFilter: 'callbacks' },
    { label: '⚠️ Mis deals sin actividad',   path: '/deals', stageFilter: 'sinActividad' },
    { label: '🔍 Buscar contactos',           path: '/search' },
  ]

  const handleQuickLink = (link) => {
    if (!link.stageFilter) return nav(link.path)
    if (link.stageFilter === 'closedwon') {
      nav(link.path, { state: { filter: { filters: [{ propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' }] } } })
    } else if (link.stageFilter === 'callbacks') {
      nav(link.path, { state: { filter: { filters: [
        { propertyName: 'closedate', operator: 'LT', value: now() },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' }
      ]}}})
    } else if (link.stageFilter === 'sinActividad') {
      nav(link.path, { state: { filter: { filters: [
        { propertyName: 'hs_lastmodifieddate', operator: 'LT', value: minus72h() },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
        { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' }
      ]}}})
    }
  }

  // ── Navegación desde gráficas ──────────────────────────────────────────────
  const handleBarClick = (bar) => {
    // bar tiene { key, label, count }
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'dealstage', operator: 'EQ', value: bar.key }
    ]}}})
  }

  const handleSliceClick = (slice) => {
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'dealstage', operator: 'EQ', value: slice.key }
    ]}}})
  }

  // ── Navegación desde tarea pendiente ──────────────────────────────────────
  const handleTaskClick = (task) => {
    if (task._assoc) {
      nav(`${ASSOC_PATHS[task._assoc.type]}/${task._assoc.id}`)
    }
  }

  return (
    <>
      <Topbar
        title={isSupervisor ? `Dashboard equipo — ${user?.name}` : `Mis pendientes — ${user?.name}`}
        action={canToggle && (
          <button
            className={`btn btn-sm ${viewAsOperator ? 'btn-primary' : 'btn-ghost'}`}
            onClick={toggleView}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            title={viewAsOperator ? 'Cambiando a vista supervisor' : 'Simular vista operador'}
          >
            <Eye size={13} />
            {viewAsOperator ? 'Vista: Operador' : 'Vista: Supervisor'}
          </button>
        )}
      />
      <div className="content">

        {/* Métricas */}
        <div className="metrics-grid">
          {metricCards.map(card => {
            const Icon = card.icon
            return (
              <div key={card.key} className={'metric-card ' + card.cls}
                onClick={() => nav('/deals', { state: { filter: card.filter } })}
                title="Clic para ver deals">
                <div className="label">
                  <Icon size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {card.label}
                </div>
                <div className="value">
                  {loadingMetrics ? '…' : metricsError ? '!' : (metrics?.[card.key] ?? 0)}
                </div>
                <div className="sublabel">{card.sublabel} · clic para ver →</div>
              </div>
            )
          })}
        </div>

        {metricsError && (
          <div className="error-msg" style={{ marginBottom: 16 }}>
            Error cargando métricas. Verifica el token de HubSpot en .env
          </div>
        )}

        {/* ── Gráficas interactivas ─────────────────────────────────────── */}
        {chartsData && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div className="card">
              <div className="card-header">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChart2 size={14} style={{ color: '#0052cc' }} />
                  Eventos por etapa {isSupervisor ? '(equipo)' : '(mis eventos)'}
                </h2>
                <span style={{ fontSize: 11, color: '#6b778c' }}>clic en barra para filtrar</span>
              </div>
              <div className="card-body" style={{ padding: '12px 16px' }}>
                <BarChart
                  data={chartsData.byStage?.map(s => ({ ...s, label: STAGE_LABELS[s.key] || s.label }))}
                  color="#0052cc"
                  onBarClick={handleBarClick}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card" style={{ flex: 1 }}>
                <div className="card-header">
                  <h2>Distribución por etapa</h2>
                  <span style={{ fontSize: 11, color: '#6b778c' }}>clic para filtrar</span>
                </div>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  <DonutChart data={chartsData.byStage} onSliceClick={handleSliceClick} />
                </div>
              </div>
              <div className="card">
                <div className="card-header"><h2>Nuevos deals · últimos 6 meses</h2></div>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  <BarChart
                    data={chartsData.byMonth?.map(m => ({ ...m, key: m.label }))}
                    color="#00875a"
                    height={100}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Pipeline de Empresas ─────────────────────────────────────── */}
        {isSupervisor && companyStages && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                🏢 Pipeline de Empresas
              </h2>
              <span style={{ fontSize: 11, color: '#6b778c' }}>clic en etapa para ver detalle</span>
            </div>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {companyStages.map(s => (
                  <div
                    key={s.key}
                    onClick={() => nav('/companies', { state: { stage: s.key } })}
                    style={{
                      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                      padding: '10px 14px', cursor: 'pointer', transition: 'all .15s',
                      textAlign: 'center'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#0052cc'; e.currentTarget.style.background = '#e8f0fe' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc' }}
                  >
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{s.label.split(' ')[0]}</div>
                    <div style={{ fontSize: 11, color: '#6b778c', marginBottom: 6 }}>
                      {s.label.split(' ').slice(1).join(' ')}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.count > 0 ? '#172b4d' : '#adb5bd' }}>
                      {s.count}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: '#6b778c', textAlign: 'right' }}>
                Total: <strong>{pipelineData?.total ?? 0}</strong> empresas
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>

          {/* Tareas pendientes — clicables */}
          <div className="card">
            <div className="card-header">
              <h2>
                <Clock size={14} style={{ verticalAlign: 'middle', marginRight: 6, color: '#ff8b00' }} />
                {isSupervisor ? 'Tareas pendientes del equipo' : 'Mis tareas pendientes'}
              </h2>
              <span className="badge badge-yellow">{tasks.length}</span>
            </div>
            {loadingTasks ? (
              <div className="loading">Cargando tareas…</div>
            ) : tasks.length === 0 ? (
              <div className="empty">
                {isSupervisor ? 'Sin tareas pendientes en el equipo ✓' : '¡Sin tareas pendientes! Estás al día ✓'}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarea</th>
                      <th>Vinculado a</th>
                      <th>Prioridad</th>
                      <th>Fecha límite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(t => {
                      const p = t.properties
                      const pri = PRIORITY_BADGE[p.hs_task_priority] || PRIORITY_BADGE.MEDIUM
                      const date = safeFmt(p.hs_timestamp)
                      const hasAssoc = !!t._assoc
                      const ASSOC_ICONS = { deals: '💼', contacts: '👤', companies: '🏭' }
                      return (
                        <tr
                          key={t.id}
                          className={hasAssoc ? 'clickable' : ''}
                          onClick={() => hasAssoc && handleTaskClick(t)}
                          title={hasAssoc ? `Ir a ${t._assoc.name}` : ''}
                        >
                          <td>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>
                              {p.hs_task_subject || '(sin título)'}
                            </div>
                            {p.hs_task_body && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                {p.hs_task_body.replace(/<[^>]+>/g, '').slice(0, 80)}
                              </div>
                            )}
                          </td>
                          <td>
                            {t._assoc ? (
                              <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span>{ASSOC_ICONS[t._assoc.type]}</span>
                                <span style={{ color: 'var(--primary)', fontWeight: 500 }}>{t._assoc.name}</span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                            )}
                          </td>
                          <td><span className={'badge ' + pri.cls}>{pri.label}</span></td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{date}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel derecho */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Accesos rápidos */}
            <div className="card">
              <div className="card-header"><h2>Accesos rápidos</h2></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {quickLinks.map((link, i) => (
                  <button key={i} className="btn btn-ghost"
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    onClick={() => handleQuickLink(link)}>
                    {link.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Perfil (operadores o vista operador) */}
            {!isSupervisor && (
              <div className="card">
                <div className="card-header"><h2>Tu perfil</h2></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="prop-item">
                    <div className="prop-label">Nombre</div>
                    <div className="prop-value">{user.name}</div>
                  </div>
                  <div className="prop-item">
                    <div className="prop-label">Rol</div>
                    <div className="prop-value">{viewAsOperator ? 'Supervisor (vista operador)' : 'Operador CRM'}</div>
                  </div>
                  <div className="prop-item">
                    <div className="prop-label">HubSpot Owner ID</div>
                    <div className="prop-value" style={{ fontFamily: 'monospace', fontSize: 12 }}>{user.ownerId}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Equipo (supervisores) */}
            {isSupervisor && (
              <div className="card">
                <div className="card-header">
                  <h2><Users size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Equipo</h2>
                  <button className="btn btn-ghost btn-sm" onClick={() => nav('/reports')} style={{ fontSize: 11 }}>
                    Ver reportes →
                  </button>
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    { name: 'Yesenia', zona: 'EEUU · Europa · LATAM Norte',        ownerId: '93621022' },
                    { name: 'Angel',   zona: 'Europa del Este · Medio Oriente',    ownerId: '93771980' },
                    { name: 'Gracie',  zona: 'Asia Pacífico · Oceanía',            ownerId: '93771979' },
                    { name: 'Carlos',  zona: 'LATAM Sur · Caribe',                 ownerId: '93771981' },
                    { name: 'Sara',    zona: 'África · Asia Central',              ownerId: '73112880' },
                  ].map(op => (
                    <div key={op.name}
                      style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12, cursor: 'pointer' }}
                      onClick={() => nav('/deals', { state: { filter: { filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: op.ownerId }] } } })}
                      title={`Ver deals de ${op.name}`}
                    >
                      <span style={{ fontWeight: 600 }}>{op.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{op.zona}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
