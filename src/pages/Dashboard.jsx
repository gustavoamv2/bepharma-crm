import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, TrendingUp, Calendar, PhoneCall, CheckSquare, Users, BarChart2, Eye } from 'lucide-react'
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
  nueva:              '#2563eb',
  en_depuracion:      '#d97706',
  en_enriquecimiento: '#7c3aed',
  contacto_enviado:   '#0369a1',
  en_seguimiento:     '#0f766e',
  confirmada:         '#15803d',
  no_participa:       '#b91c1c',
}
const STAGE_LABELS = {
  nueva:              'Nueva',
  en_depuracion:      'En depuracion',
  en_enriquecimiento: 'En enriquecimiento',
  contacto_enviado:   'Contacto enviado',
  en_seguimiento:     'En seguimiento',
  confirmada:         'Confirmada BePharma',
  no_participa:       'No participa',
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

const ACTIVE_EVENT = 'BEPH-2026-09'

const ESTADO_LABELS = {
  nueva:              'Nueva',
  en_depuracion:      'En Depuracion',
  en_enriquecimiento: 'En Enriquecimiento',
  contacto_enviado:   'Contacto enviado',
  en_seguimiento:     'En seguimiento',
  confirmada:         'Confirmada BePharma',
  no_participa:       'No participa',
}

const nowMs = () => String(Date.now())
const minus72hMs = () => String(Date.now() - 72 * 3600 * 1000)
const startMonthMs = () => String(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime())

export default function Dashboard() {
  const nav = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  // Toggle supervisor/operador para usuarios con rol supervisor (Yesenia, Roberto)
  const [viewAsOperator, setViewAsOperator] = useState(
    () => sessionStorage.getItem('bp_view_mode') === 'operator'
  )
  const toggleView = () => {
    const next = !viewAsOperator
    if (next) sessionStorage.setItem('bp_view_mode', 'operator')
    else sessionStorage.removeItem('bp_view_mode')
    // Notificar al sidebar para que actualice el menú inmediatamente
    window.dispatchEvent(new Event('bpViewModeChange'))
    // Elimina cache para forzar refetch con la nueva vista al renderizar
    qc.removeQueries(['metrics'])
    qc.removeQueries(['charts'])
    setViewAsOperator(next)
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

  // ── Alertas del supervisor ────────────────────────────────────────────────
  // El servidor aplica applyOwnerFilter automáticamente (operadores solo ven sus propios deals)
  const { data: alertsData } = useQuery(
    ['deals-alertas', user?.username, viewAsOperator],
    () => hubspot.searchDeals({
      filters: [
        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: ACTIVE_EVENT },
        { propertyName: 'bp_estado_alerta', operator: 'HAS_PROPERTY' },
      ],
      properties: ['dealname', 'bp_estado_alerta', 'bp_estado_prospeccion'],
      limit: 25,
      sorts: [{ propertyName: 'bp_estado_alerta', direction: 'DESCENDING' }],
    }),
    { refetchInterval: 2 * 60 * 1000 }
  )
  const alertDeals = alertsData?.results || []

  // ── Metricas cards usando propiedades BePharma ────────────────────────────
  const metricCards = [
    {
      key: 'sinActividad72h',
      label: 'Sin actividad +72h',
      sublabel: 'Ultima actividad hace mas de 3 dias',
      icon: AlertTriangle, cls: 'metric-danger',
      filter: { filters: [
        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
        { propertyName: 'bp_ultima_actividad_operador', operator: 'LT', value: minus72hMs() },
        { propertyName: 'bp_estado_prospeccion', operator: 'NEQ', value: 'confirmada' },
        { propertyName: 'bp_estado_prospeccion', operator: 'NEQ', value: 'no_participa' },
      ]}
    },
    {
      key: 'callbacksVencidos',
      label: isSupervisor ? 'Callbacks vencidos' : 'Mis callbacks vencidos',
      sublabel: 'Fecha de proximo contacto vencida',
      icon: PhoneCall, cls: 'metric-danger',
      filter: { filters: [
        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
        { propertyName: 'bp_proximo_contacto', operator: 'LT', value: nowMs() },
        { propertyName: 'bp_estado_prospeccion', operator: 'NEQ', value: 'confirmada' },
        { propertyName: 'bp_estado_prospeccion', operator: 'NEQ', value: 'no_participa' },
      ]}
    },
    {
      key: 'sinProximoContacto',
      label: 'Sin proximo contacto',
      sublabel: 'Sin fecha de seguimiento agendada',
      icon: Calendar, cls: 'metric-warning',
      filter: { filters: [
        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
        { propertyName: 'bp_proximo_contacto', operator: 'NOT_HAS_PROPERTY' },
        { propertyName: 'bp_estado_prospeccion', operator: 'NEQ', value: 'confirmada' },
        { propertyName: 'bp_estado_prospeccion', operator: 'NEQ', value: 'no_participa' },
      ]}
    },
    {
      key: 'confirmadasBePharma',
      label: isSupervisor ? 'Confirmadas BePharma' : 'Mis confirmadas',
      sublabel: `Confirmadas en ${ACTIVE_EVENT}`,
      icon: CheckSquare, cls: 'metric-success',
      filter: { filters: [
        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
        { propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: 'confirmada' },
      ]}
    },
    ...(isSupervisor ? [{
      key: 'nuevosEsteMes',
      label: 'Nuevos este mes',
      sublabel: `Creados en ${ACTIVE_EVENT} este mes`,
      icon: TrendingUp, cls: 'metric-primary',
      filter: { filters: [
        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
        { propertyName: 'createdate', operator: 'GTE', value: startMonthMs() },
      ]}
    }] : [])
  ]

  // ── Accesos rapidos ───────────────────────────────────────────────────────
  const quickLinks = isSupervisor ? [
    { label: 'Todos los eventos activos', path: '/deals' },
    { label: 'Confirmadas BePharma',      path: '/deals', stageFilter: 'confirmada' },
    { label: 'Pipeline de Eventos',       path: '/kanban' },
    { label: 'Todas las empresas',        path: '/companies' },
    { label: 'Reportes del equipo',       path: '/reports' },
    { label: 'Buscar en Apollo / RR',     path: '/search' },
  ] : [
    { label: 'Mis eventos activos',       path: '/deals' },
    { label: 'Pipeline de Eventos',       path: '/kanban' },
    { label: 'Mis callbacks vencidos',    path: '/deals', stageFilter: 'callbacks' },
    { label: 'Sin actividad +72h',        path: '/deals', stageFilter: 'sinActividad' },
    { label: 'Buscar contactos',          path: '/search' },
  ]

  const handleQuickLink = (link) => {
    if (!link.stageFilter) return nav(link.path)
    if (link.stageFilter === 'confirmada') {
      nav(link.path, { state: { filter: { filters: [
        { propertyName: 'bp_evento_codigo',      operator: 'EQ',  value: 'BEPH-2026-09' },
        { propertyName: 'bp_estado_prospeccion', operator: 'EQ',  value: 'confirmada' },
      ]}}})
    } else if (link.stageFilter === 'callbacks') {
      nav(link.path, { state: { filter: { filters: [
        { propertyName: 'bp_evento_codigo',      operator: 'EQ',  value: 'BEPH-2026-09' },
        { propertyName: 'bp_proximo_contacto',   operator: 'LT',  value: nowMs() },
        { propertyName: 'bp_estado_prospeccion', operator: 'NEQ', value: 'confirmada' },
        { propertyName: 'bp_estado_prospeccion', operator: 'NEQ', value: 'no_participa' },
      ]}}})
    } else if (link.stageFilter === 'sinActividad') {
      nav(link.path, { state: { filter: { filters: [
        { propertyName: 'bp_evento_codigo',            operator: 'EQ',  value: 'BEPH-2026-09' },
        { propertyName: 'bp_ultima_actividad_operador',operator: 'LT',  value: minus72hMs() },
        { propertyName: 'bp_estado_prospeccion',       operator: 'NEQ', value: 'confirmada' },
        { propertyName: 'bp_estado_prospeccion',       operator: 'NEQ', value: 'no_participa' },
      ]}}})
    }
  }

  // ── Navegación desde gráficas ──────────────────────────────────────────────
  const handleBarClick = (bar) => {
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'bp_evento_codigo',      operator: 'EQ', value: ACTIVE_EVENT },
      { propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: bar.key },
    ]}}})
  }

  const handleSliceClick = (slice) => {
    nav('/deals', { state: { filter: { filters: [
      { propertyName: 'bp_evento_codigo',      operator: 'EQ', value: ACTIVE_EVENT },
      { propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: slice.key },
    ]}}})
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

        {/* ── Pipeline: gráficas + distribución (fusionadas) ───────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart2 size={14} style={{ color: '#0052cc' }} />
              Pipeline {ACTIVE_EVENT} · {isSupervisor ? 'equipo' : 'mis eventos'}
            </h2>
            <span style={{ fontSize: 11, color: '#6b778c' }}>clic en gráfica para filtrar</span>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>

            {/* Distribución por estado — chips (solo supervisor) */}
            {isSupervisor && (() => {
              // Usa chartsData.byStage si tiene datos; si no, fallback a metrics.porEstado
              const chipsFromCharts = chartsData?.byStage?.filter(s => s.count > 0)
              const chipsFromMetrics = metrics?.porEstado
                ? Object.entries(metrics.porEstado).filter(([, c]) => c > 0).map(([key, count]) => ({ key, label: ESTADO_LABELS[key] || key, count }))
                : null
              const chips = (chipsFromCharts?.length ? chipsFromCharts : chipsFromMetrics) || []
              if (!chips.length) return null
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                  {chips.map(({ key, label, count }) => (
                    <div key={key}
                      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', textAlign: 'center', minWidth: 110 }}
                      onClick={() => nav('/deals', { state: { filter: { filters: [
                        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: 'BEPH-2026-09' },
                        { propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: key },
                      ]}}})}
                    >
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)' }}>{count}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{label || ESTADO_LABELS[key] || key}</div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Gráficas */}
            {chartsData && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#6b778c', marginBottom: 6 }}>Eventos por etapa</div>
                  <BarChart
                    data={chartsData.byStage?.map(s => ({ ...s, label: STAGE_LABELS[s.key] || s.label }))}
                    color="#0052cc"
                    onBarClick={handleBarClick}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b778c', marginBottom: 6 }}>Distribución por etapa</div>
                    <DonutChart data={chartsData.byStage} onSliceClick={handleSliceClick} />
                  </div>
                  {chartsData.byMonth?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: '#6b778c', marginBottom: 6 }}>Nuevos eventos · últimos 6 meses</div>
                      <BarChart
                        data={chartsData.byMonth.map(m => ({ ...m, key: m.label }))}
                        color="#00875a"
                        height={100}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Alertas del supervisor ────────────────────────────────────── */}
        {alertDeals.length > 0 && (
          <div className="card" style={{ marginBottom: 16, border: '1.5px solid #b91c1c' }}>
            <div className="card-header" style={{ background: 'rgba(185,28,28,0.06)' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b91c1c' }}>
                <AlertTriangle size={14} />
                {isSupervisor ? 'Eventos con alerta activa' : 'Alertas del supervisor'}
              </h2>
              <span className="badge badge-red">{alertDeals.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Evento / empresa</th>
                    <th>Alerta</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {alertDeals.map(d => {
                    const p = d.properties
                    const isRed = p.bp_estado_alerta === 'alerta_roja'
                    return (
                      <tr key={d.id} className="clickable" style={{ cursor: 'pointer' }}
                        onClick={() => nav(`/deals/${d.id}`)}>
                        <td style={{ fontWeight: 500 }}>{p.dealname || '—'}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: isRed ? '#b91c1c' : '#b45309' }}>
                            <AlertTriangle size={11} />
                            {isRed ? 'Alerta roja' : 'Alerta amarilla'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {STAGE_LABELS[p.bp_estado_prospeccion] || p.bp_estado_prospeccion || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Panel inferior: accesos rápidos + equipo/perfil ─────── */}
        {isSupervisor ? (
          /* Supervisor: quicklinks + equipo en fila */
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 200px' }}>
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
            <div className="card" style={{ flex: '2 1 320px' }}>
              <div className="card-header">
                <h2><Users size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Equipo</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => nav('/reports')} style={{ fontSize: 11 }}>
                  Ver reportes →
                </button>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { name: 'Yesenia', zona: 'EEUU · Europa · LATAM Norte',     ownerId: '93621022' },
                  { name: 'Angel',   zona: 'Europa del Este · Medio Oriente', ownerId: '93771980' },
                  { name: 'Gracie',  zona: 'Asia Pacífico · Oceanía',         ownerId: '93771979' },
                  { name: 'Carlos',  zona: 'LATAM Sur · Caribe',              ownerId: '93771981' },
                  { name: 'Sara',    zona: 'África · Asia Central',           ownerId: '73112880' },
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
          </div>
        ) : (
          /* Panel operador — accesos rápidos + perfil en fila */
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 240px' }}>
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
            <div className="card" style={{ flex: '1 1 240px' }}>
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
          </div>
        )}
      </div>
    </>
  )
}
