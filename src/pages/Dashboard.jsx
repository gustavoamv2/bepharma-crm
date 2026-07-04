import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, TrendingUp, Calendar, PhoneCall, CheckSquare, Users, BarChart2, Eye } from 'lucide-react'
import { hubspot, admin } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import { useAuth } from '../contexts/AuthContext'
import { BarChart, DonutChart } from '../components/Charts'
import TaskDetailModal from '../components/TaskDetailModal'

// ── Colores/labels de etapa (compartidos con DealList/CompanyList vía las
// mismas claves de bp_estado_prospeccion) ────────────────────────────────────
const STAGE_COLORS = {
  nueva:            '#2563eb',
  en_depuracion:   '#d97706',
  contacto_enviado: '#0369a1',
  en_seguimiento:  '#0f766e',
  confirmada:      '#15803d',
  no_participa:    '#b91c1c',
}
const STAGE_LABELS = {
  nueva:            'Nueva',
  en_depuracion:   'En Depuración',
  en_enriquecimiento: 'En Enriquecimiento',
  contacto_enviado: 'Por Contactar',
  en_seguimiento:  'En Seguimiento',
  confirmada:      'Confirmada',
  no_participa:    'No Participa',
}
// Versión corta solo para el eje del gráfico de barras (7 columnas angostas):
// evita que palabras largas como "Enriquecimiento" invadan la columna vecina.
// La leyenda del donut sigue usando el nombre completo (STAGE_LABELS).
const STAGE_LABELS_SHORT = {
  nueva:            'Nueva',
  en_depuracion:   'Depuración',
  en_enriquecimiento: 'Enriquec.',
  contacto_enviado: 'Contactar',
  en_seguimiento:  'Seguim.',
  confirmada:      'Confirmada',
  no_participa:    'No particip.',
}

const ACTIVE_EVENT = 'BEPH-2026-09'

// Mapa ownerId → nombre de operador (mismo mapeo que DealList.jsx), usado en
// las tablas de Alertas y Tareas pendientes de la vista supervisor.
const OWNER_NAMES = {
  '93615311': 'Roberto',
  '93621022': 'Yesenia',
  '93771980': 'Angel',
  '93771979': 'Gracie',
  '93771981': 'Carlos',
  '73112880': 'Sara',
}

const ESTADO_LABELS = {
  nueva:            'Nueva',
  en_depuracion:   'En Depuración',
  en_enriquecimiento: 'En Enriquecimiento',
  contacto_enviado: 'Por Contactar',
  en_seguimiento:  'En Seguimiento',
  confirmada:      'Confirmada',
  no_participa:    'No Participa',
}

// Paleta de colores del banner de métricas (mismo estilo que Reportes)
const METRIC_COLORS = {
  'metric-danger':  '#de350b',
  'metric-warning': '#ff8b00',
  'metric-success': '#00875a',
  'metric-primary': '#0052cc',
}

const nowMs = () => String(Date.now())
const minus72hMs = () => String(Date.now() - 72 * 3600 * 1000)
const startMonthMs = () => String(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime())

export default function Dashboard() {
  const nav = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [taskDetail, setTaskDetail] = useState(null)

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
  const canToggle = user?.role === 'supervisor' && user?.canToggleView !== false

  const { data: metrics, isLoading: loadingMetrics, error: metricsError } = useQuery(
    ['metrics', user?.username, viewAsOperator],
    hubspot.metrics,
    { refetchInterval: 5 * 60 * 1000 }
  )

  const { data: chartsData } = useQuery(
    ['charts', user?.username, viewAsOperator],
    () => hubspot.charts(),
    { refetchInterval: 10 * 60 * 1000 }
  )

  // Equipo (para el panel de supervisor) — países asignados reales, no hardcodeados
  const { data: teamUsers } = useQuery('admin-users', admin.getUsers, {
    enabled: isSupervisor,
    staleTime: 60_000,
  })
  const team = (teamUsers || [])
    .filter(u => u.role === 'operator')
    .map(u => ({ name: u.name, ownerId: u.ownerId, paises: (u.bp_paises || []).join(' · ') || 'Sin países asignados' }))

  // ── Alertas del supervisor ────────────────────────────────────────────────
  // El servidor aplica applyOwnerFilter automáticamente (operadores solo ven sus propios deals)
  const { data: alertsData, error: alertsError } = useQuery(
    ['deals-alertas', user?.username, viewAsOperator],
    () => hubspot.searchDeals({
      filters: [
        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: ACTIVE_EVENT },
        { propertyName: 'bp_estado_alerta', operator: 'HAS_PROPERTY' },
      ],
      properties: ['dealname', 'bp_estado_alerta', 'bp_estado_prospeccion', 'hs_lastmodifieddate', 'hubspot_owner_id'],
      limit: 25,
      // La Search API de HubSpot solo admite UN campo de orden por request
      // (mandar 2 devuelve VALIDATION_ERROR "Only one sort field is allowed"
      // y la query fallaba silenciosamente — la tarjeta de alertas desaparecía
      // por completo, tanto en vista supervisor como operador).
      // Ordenamos por actividad reciente en el servidor (para no perder alertas
      // recien levantadas fuera del top-25) y reordenamos por severidad en el
      // cliente — Array.sort es estable, asi que dentro de cada severidad se
      // conserva el orden por mas reciente primero.
      sorts: [
        { propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' },
      ],
    }),
    { refetchInterval: 2 * 60 * 1000 }
  )
  const alertDeals = [...(alertsData?.results || [])].sort((a, b) => {
    const sev = (p) => p.bp_estado_alerta === 'alerta_roja' ? 0 : 1
    return sev(a.properties) - sev(b.properties)
  })
  // total real de HubSpot (no el .length de la lista, que esta topada a 25)
  const alertsTotal = alertsData?.total ?? alertDeals.length

  // ── Tareas pendientes (endpoint ya existía en el backend — GET
  // /api/hubspot/tasks/pending, filtra por owner cuando es vista de operador
  // — pero nunca se mostraba en ningún lado del CRM propio, por eso una tarea
  // programada desde el detalle de un Deal/Empresa/Contacto no aparecía en
  // ningún dashboard aunque se hubiera creado correctamente en HubSpot) ─────
  const { data: pendingTasksData, error: pendingTasksError } = useQuery(
    ['pending-tasks', user?.username, viewAsOperator],
    hubspot.getPendingTasks,
    { refetchInterval: 2 * 60 * 1000 }
  )
  const pendingTasks = pendingTasksData?.results || []
  const pendingTasksTotal = pendingTasksData?.total ?? pendingTasks.length

  const TASK_ASSOC_PATH = { deals: '/deals', contacts: '/contacts', companies: '/companies' }
  const PRIORITY_LABELS = { HIGH: '🔴 Alta', MEDIUM: '🟡 Media', LOW: '🟢 Baja' }

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
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          {metricCards.map(card => {
            const Icon = card.icon
            const color = METRIC_COLORS[card.cls] || '#0052cc'
            return (
              <div key={card.key}
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 18px', minWidth: 140, textAlign: 'center', cursor: 'pointer' }}
                onClick={() => nav('/deals', { state: { filter: card.filter } })}
                title={`${card.sublabel} · clic para ver`}>
                <Icon size={16} style={{ color, marginBottom: 4 }} />
                <div style={{ fontSize: 26, fontWeight: 800, color }}>
                  {loadingMetrics ? '…' : metricsError ? '!' : (metrics?.[card.key] ?? 0)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{card.label}</div>
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
                    data={chartsData.byStage?.map(s => ({ ...s, label: STAGE_LABELS_SHORT[s.key] || s.label }))}
                    color="#0052cc"
                    onBarClick={handleBarClick}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b778c', marginBottom: 6 }}>Distribución por etapa</div>
                    <DonutChart
                      data={chartsData.byStage?.map(s => ({ ...s, label: STAGE_LABELS[s.key] || s.label, color: STAGE_COLORS[s.key] }))}
                      onSliceClick={handleSliceClick}
                      centerLabel="eventos"
                    />
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
        {alertsError && (
          <div className="error-msg" style={{ marginBottom: 16 }}>
            Error cargando alertas: {alertsError.response?.data?.error?.message || alertsError.response?.data?.error || alertsError.message}
          </div>
        )}
        {alertsTotal > 0 && (
          <div className="card" style={{ marginBottom: 16, border: '1.5px solid #b91c1c' }}>
            <div className="card-header" style={{ background: 'rgba(185,28,28,0.06)' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b91c1c' }}>
                <AlertTriangle size={14} />
                {isSupervisor ? 'Eventos con alerta activa' : 'Alertas del supervisor'}
              </h2>
              <span className="badge badge-red">{alertsTotal}</span>
            </div>
            {alertsTotal > alertDeals.length && (
              <div style={{ padding: '6px 14px', fontSize: 11, color: '#92400e', background: '#fff8e1', borderBottom: '1px solid #f59e0b' }}>
                Mostrando las {alertDeals.length} más recientes de {alertsTotal} en total.
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Evento / empresa</th>
                    <th>Alerta</th>
                    <th>Estado</th>
                    <th>Operador</th>
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
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {OWNER_NAMES[p.hubspot_owner_id] || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tareas pendientes (programadas desde Deal/Empresa/Contacto) ── */}
        {pendingTasksError && (
          <div className="error-msg" style={{ marginBottom: 16 }}>
            Error cargando tareas: {pendingTasksError.response?.data?.error || pendingTasksError.message}
          </div>
        )}
        {pendingTasksTotal > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckSquare size={14} style={{ color: '#0052cc' }} />
                {isSupervisor ? 'Tareas pendientes del equipo' : 'Mis tareas pendientes'}
              </h2>
              <span className="badge badge-blue">{pendingTasksTotal}</span>
            </div>
            {pendingTasksTotal > pendingTasks.length && (
              <div style={{ padding: '6px 14px', fontSize: 11, color: '#92400e', background: '#fff8e1', borderBottom: '1px solid #f59e0b' }}>
                Mostrando las {pendingTasks.length} más próximas de {pendingTasksTotal} en total.
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tarea</th>
                    <th>Operador</th>
                    <th>Vence</th>
                    <th>Prioridad</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTasks.map(t => {
                    const p = t.properties || {}
                    const assoc = t._assoc
                    const due = p.hs_timestamp ? new Date(p.hs_timestamp) : null
                    const isOverdue = due && !isNaN(due) && due.getTime() < Date.now()
                    return (
                      <tr key={t.id} className="clickable" style={{ cursor: 'pointer' }}
                        onClick={() => setTaskDetail(t)}
                        title={assoc?.name ? `Vinculado a: ${assoc.name}` : undefined}>
                        <td style={{ fontWeight: 500 }}>{p.hs_task_subject || '(sin asunto)'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{OWNER_NAMES[p.hubspot_owner_id] || '—'}</td>
                        <td style={{ fontSize: 12, color: isOverdue ? 'var(--danger)' : undefined, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {isOverdue && <Calendar size={11} />}
                          {due && !isNaN(due) ? due.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td style={{ fontSize: 12 }}>{PRIORITY_LABELS[p.hs_task_priority] || p.hs_task_priority || '—'}</td>
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
                {team.map(op => (
                  <div key={op.name}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12, cursor: 'pointer' }}
                    onClick={() => nav('/deals', { state: { filter: { filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: op.ownerId }] } } })}
                    title={`Ver deals de ${op.name}`}
                  >
                    <span style={{ fontWeight: 600, flexShrink: 0, minWidth: 60 }}>{op.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, flex: 1, textAlign: 'right' }}>{op.paises}</span>
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
                <div className="prop-item">
                  <div className="prop-label">Países asignados</div>
                  <div className="prop-value">{user.bp_paises?.length ? user.bp_paises.join(' · ') : 'Sin países asignados'}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {taskDetail && (
        <TaskDetailModal
          task={taskDetail}
          onClose={() => setTaskDetail(null)}
          ownerNames={OWNER_NAMES}
          priorityLabels={PRIORITY_LABELS}
          assocPath={TASK_ASSOC_PATH}
          onNavigate={nav}
        />
      )}
    </>
  )
}
