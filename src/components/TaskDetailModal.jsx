import React, { useEffect } from 'react'
import { X, CheckSquare, Calendar, ExternalLink } from 'lucide-react'

// Detalle de una tarea pendiente (usado desde el widget "Tareas pendientes"
// del Dashboard) — antes el clic en la fila navegaba directo al registro
// asociado (deal/contacto/empresa); ahora primero muestra el detalle de la
// tarea en sí (asunto, notas, vencimiento, prioridad, operador) y desde ahí
// se puede saltar al registro vinculado si existe.
export default function TaskDetailModal({ task, onClose, ownerNames = {}, priorityLabels = {}, assocPath = {}, onNavigate }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const p = task?.properties || {}
  const assoc = task?._assoc
  const due = p.hs_timestamp ? new Date(Number(p.hs_timestamp)) : null
  const isOverdue = due && !isNaN(due) && due.getTime() < Date.now()
  const goTo = assoc && assocPath[assoc.type] ? `${assocPath[assoc.type]}/${assoc.id}` : null

  const ASSOC_LABEL = { deals: 'Evento', contacts: 'Contacto', companies: 'Empresa' }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: 12, width: 460, maxWidth: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,.25)', overflow: 'hidden',
      }}>
        <div style={{
          background: '#0a1929', padding: '16px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontWeight: 700, fontSize: 15 }}>
            <CheckSquare size={16} /> Detalle de la tarea
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#78909c', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Asunto</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#172b4d' }}>{p.hs_task_subject || '(sin asunto)'}</div>
          </div>

          {p.hs_task_body && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Notas</div>
              <div style={{ fontSize: 13, color: '#42526e', whiteSpace: 'pre-wrap' }}>{p.hs_task_body}</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Vence</div>
              <div style={{ fontSize: 13, color: isOverdue ? 'var(--danger)' : '#172b4d', display: 'flex', alignItems: 'center', gap: 4 }}>
                {isOverdue && <Calendar size={12} />}
                {due && !isNaN(due) ? due.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Prioridad</div>
              <div style={{ fontSize: 13, color: '#172b4d' }}>{priorityLabels[p.hs_task_priority] || p.hs_task_priority || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Operador</div>
              <div style={{ fontSize: 13, color: '#172b4d' }}>{ownerNames[p.hubspot_owner_id] || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Vinculado a</div>
              <div style={{ fontSize: 13, color: '#172b4d' }}>
                {assoc?.name ? `${ASSOC_LABEL[assoc.type] || ''}: ${assoc.name}` : '—'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
            {goTo && (
              <button
                className="btn btn-primary"
                onClick={() => { onNavigate(goTo); onClose() }}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                Ver {ASSOC_LABEL[assoc.type]} <ExternalLink size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
