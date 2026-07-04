import React, { useState } from 'react'
import { hubspot } from '../hooks/useApi'

// El tab de "Seguimiento" (creaba una tarea sin control de a quién se le
// asignaba) se quitó del panel inferior de los deals — para programar una
// tarea/alerta ahora se usa el botón "Tarea" del detalle (CreateTaskModal),
// que sí respeta las reglas de asignación por rol.
const TABS = [
  { key: 'note',     label: '📝 Nota' },
  { key: 'linkedin', label: '💼 LinkedIn' },
]

export default function ActivityBar({ objectType, objectId, objectName, onActivityLogged }) {
  const [activeTab, setActiveTab] = useState(null)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState(null)

  // Note state
  const [noteText, setNoteText] = useState('')

  // LinkedIn state
  const [linkedinMsg, setLinkedinMsg] = useState('')

  const showFeedback = (msg, type = 'success') => {
    setFeedback({ msg, type })
    setTimeout(() => setFeedback(null), 3000)
  }

  const reset = () => {
    setNoteText('')
    setLinkedinMsg('')
  }

  const handleTabClick = (key) => {
    setActiveTab(prev => prev === key ? null : key)
    setFeedback(null)
  }

  const saveNote = async () => {
    if (!noteText.trim()) return
    setLoading(true)
    try {
      await hubspot.createNote(objectType, objectId, noteText.trim(), 'NOTE')
      showFeedback('Nota guardada')
      reset()
      setActiveTab(null)
      onActivityLogged?.()
    } catch (e) {
      showFeedback(e.response?.data?.error || 'Error al guardar', 'error')
    } finally {
      setLoading(false)
    }
  }

  const saveLinkedin = async () => {
    if (!linkedinMsg.trim()) return
    setLoading(true)
    try {
      await hubspot.createNote(objectType, objectId, linkedinMsg.trim(), 'LINKEDIN')
      showFeedback('Mensaje LinkedIn guardado')
      reset()
      setActiveTab(null)
      onActivityLogged?.()
    } catch (e) {
      showFeedback(e.response?.data?.error || 'Error al guardar', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="activity-bar">
      <div className="activity-bar-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`abar-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => handleTabClick(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab && (
        <div className="activity-bar-body">
          {feedback && (
            <div className={`abar-feedback ${feedback.type}`} style={{ marginBottom: 10 }}>
              {feedback.msg}
            </div>
          )}

          {/* NOTA */}
          {activeTab === 'note' && (
            <div className="abar-form">
              <textarea
                rows={3}
                placeholder={`Agregar nota sobre ${objectName || 'este registro'}…`}
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                style={{ resize: 'vertical' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab(null)}>Cancelar</button>
                <button className="btn btn-primary btn-sm" onClick={saveNote} disabled={loading || !noteText.trim()}>
                  {loading ? 'Guardando…' : 'Guardar nota'}
                </button>
              </div>
            </div>
          )}

          {/* LINKEDIN */}
          {activeTab === 'linkedin' && (
            <div className="abar-form">
              <textarea
                rows={3}
                placeholder="¿Qué mensaje enviaste por LinkedIn?"
                value={linkedinMsg}
                onChange={e => setLinkedinMsg(e.target.value)}
                style={{ resize: 'vertical' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab(null)}>Cancelar</button>
                <button className="btn btn-primary btn-sm" onClick={saveLinkedin} disabled={loading || !linkedinMsg.trim()}>
                  {loading ? 'Guardando…' : 'Guardar mensaje'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
