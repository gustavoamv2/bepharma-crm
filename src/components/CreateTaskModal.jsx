import React, { useState, useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import { useTeam } from '../hooks/useTeam'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'

const PRIORITIES = [
  { value: 'HIGH',   label: '🔴 Alta' },
  { value: 'MEDIUM', label: '🟡 Media' },
  { value: 'LOW',    label: '🟢 Baja' },
]

const TASK_TYPES = [
  { value: 'CALL',       label: '📞 Llamada' },
  { value: 'EMAIL',      label: '📧 Email' },
  { value: 'FOLLOWUP',   label: '🔁 Follow-up' },
  { value: 'REVIEW',     label: '👁 Revisar' },
  { value: 'OTHER',      label: '📋 Otro' },
]

export default function CreateTaskModal({
  onClose,
  associatedObjectType,
  associatedObjectId,
  associatedObjectName,
  defaultAssignee,
}) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const isSupervisor = user?.role === 'supervisor'

  // El equipo sale del backend, no de una lista fija: así los usuarios dados de
  // alta desde Administración aparecen aquí solos.
  const team = useTeam()

  // Reglas de asignación (ver también la validación server-side en
  // POST /api/hubspot/tasks):
  //   - Operador: puede asignar la tarea a sí mismo o a un supervisor.
  //   - Supervisor: puede asignar a cualquier operador (no a supervisores, ni
  //     siquiera a sí mismo, por regla de negocio).
  const assignableTeam = useMemo(() => {
    // Un usuario desactivado no recibe trabajo nuevo, y sin owner de HubSpot no
    // puede ser destinatario de una tarea de HubSpot.
    const todos = team.filter(m => m.ownerId && !m.disabled)
    return isSupervisor
      ? todos.filter(m => m.role === 'operator')
      : todos.filter(m => m.ownerId === user?.ownerId || m.role === 'supervisor')
  }, [team, isSupervisor, user?.ownerId])

  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    subject: '',
    body: '',
    assignedOwnerId: '',
    priority: 'MEDIUM',
    taskType: 'CALL',
    dueDate: '',
  })

  // El equipo llega por red, así que el destinatario inicial se fija cuando
  // carga (y solo si el que hay no es válido, para no pisar lo que el usuario
  // ya haya elegido).
  useEffect(() => {
    if (assignableTeam.length === 0) return
    setForm(f => {
      if (f.assignedOwnerId && assignableTeam.some(m => m.ownerId === f.assignedOwnerId)) return f
      const inicial = (defaultAssignee && assignableTeam.some(m => m.ownerId === defaultAssignee))
        ? defaultAssignee
        : assignableTeam[0].ownerId
      return { ...f, assignedOwnerId: inicial }
    })
  }, [assignableTeam, defaultAssignee])

  // Escape para cerrar
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }))

  const handleSave = async () => {
    if (!form.subject.trim() || !form.dueDate) {
      addToast('Completa el asunto y la fecha límite', 'error')
      return
    }
    setLoading(true)
    try {
      const taskSubject = form.taskType !== 'OTHER'
        ? `[${TASK_TYPES.find(t => t.value === form.taskType)?.label.replace(/^.+ /, '')}] ${form.subject}`
        : form.subject

      await hubspot.createTask({
        subject: taskSubject,
        body: form.body.trim(),
        dueDate: form.dueDate,
        priority: form.priority,
        assignedOwnerId: form.assignedOwnerId,
        associatedObjectType,
        associatedObjectId,
      })
      addToast('Tarea creada correctamente', 'success')
      onClose()
    } catch (e) {
      addToast(e.response?.data?.error || 'Error al crear la tarea', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: 12, width: 520, maxWidth: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,.25)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          background: '#0a1929', padding: '16px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>🚨 Crear alerta / tarea</div>
            {associatedObjectName && (
              <div style={{ color: '#78909c', fontSize: 12, marginTop: 2 }}>
                Vinculado a: {associatedObjectName}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#78909c', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Asunto */}
          <div className="form-group" style={{ margin: 0 }}>
            <label>Asunto *</label>
            <input
              type="text"
              placeholder="ej: Llamar antes de las 3pm hoy"
              value={form.subject}
              onChange={e => set('subject', e.target.value)}
              autoFocus
            />
          </div>

          {/* Grid: asignar + prioridad */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Asignar a</label>
              <select value={form.assignedOwnerId} onChange={e => set('assignedOwnerId', e.target.value)}>
                {assignableTeam.length === 0 && <option value="">Cargando equipo…</option>}
                {assignableTeam.map(m => (
                  <option key={m.ownerId} value={m.ownerId}>
                    {m.name}{m.role === 'supervisor' ? ' (supervisor)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Prioridad</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}>
                {PRIORITIES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Grid: tipo + fecha */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Tipo de tarea</label>
              <select value={form.taskType} onChange={e => set('taskType', e.target.value)}>
                {TASK_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Fecha límite *</label>
              <input
                type="datetime-local"
                value={form.dueDate}
                onChange={e => set('dueDate', e.target.value)}
              />
            </div>
          </div>

          {/* Descripción */}
          <div className="form-group" style={{ margin: 0 }}>
            <label>Instrucciones / descripción</label>
            <textarea
              rows={3}
              placeholder="Contexto adicional o instrucciones para el operador…"
              value={form.body}
              onChange={e => set('body', e.target.value)}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={loading || !form.subject.trim() || !form.dueDate}
            >
              {loading ? 'Creando…' : '🚨 Crear tarea'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
