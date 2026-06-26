import React, { useState } from 'react'
import { hubspot } from '../hooks/useApi'

const TABS = [
  { key: 'note',     label: '📝 Nota' },
  { key: 'call',     label: '📞 Llamada' },
  { key: 'linkedin', label: '💼 LinkedIn' },
  { key: 'followup', label: '📅 Seguimiento' },
]

const CALL_OUTCOMES = [
  { value: 'CONNECTED',        label: 'Contestó' },
  { value: 'NO_ANSWER',        label: 'No contestó' },
  { value: 'LEFT_VOICEMAIL',   label: 'Buzón de voz' },
  { value: 'BUSY',             label: 'Ocupado' },
  { value: 'WRONG_NUMBER',     label: 'Número equivocado' },
]

export default function ActivityBar({ objectType, objectId, objectName, onActivityLogged }) {
  const [activeTab, setActiveTab] = useState(null)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState(null)

  // Note state
  const [noteText, setNoteText] = useState('')

  // Call state
  const [callOutcome, setCallOutcome] = useState('CONNECTED')
  const [callDuration, setCallDuration] = useState('')
  const [callNotes, setCallNotes] = useState('')
  const [callPhone, setCallPhone] = useState('')

  // LinkedIn state
  const [linkedinMsg, setLinkedinMsg] = useState('')

  // Follow-up state
  const [followupDate, setFollowupDate] = useState('')
  const [followupNotes, setFollowupNotes] = useState('')

  const showFeedback = (msg, type = 'success') => {
    setFeedback({ msg, type })
    setTimeout(() => setFeedback(null), 3000)
  }

  const reset = () => {
    setNoteText('')
    setCallOutcome('CONNECTED')
    setCallDuration('')
    setCallNotes('')
    setCallPhone('')
    setLinkedinMsg('')
    setFollowupDate('')
    setFollowupNotes('')
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

  const saveCall = async () => {
    setLoading(true)
    try {
      await hubspot.logCall({
        objectType,
        objectId,
        outcome: callOutcome,
        durationSeconds: callDuration ? parseInt(callDuration) : 0,
        notes: callNotes.trim(),
        phoneNumber: callPhone.trim(),
      })
      showFeedback('Llamada registrada')
      reset()
      setActiveTab(null)
      onActivityLogged?.()
    } catch (e) {
      showFeedback(e.response?.data?.error || 'Error al registrar', 'error')
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

  const saveFollowup = async () => {
    if (!followupDate) return
    setLoading(true)
    try {
      await hubspot.createTask({
        subject: `Seguimiento: ${objectName || 'registro'}`,
        body: followupNotes.trim(),
        dueDate: followupDate,
        priority: 'MEDIUM',
        associatedObjectType: objectType,
        associatedObjectId: objectId,
      })
      showFeedback('Seguimiento programado')
      reset()
      setActiveTab(null)
      onActivityLogged?.()
    } catch (e) {
      showFeedback(e.response?.data?.error || 'Error al programar', 'error')
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

          {/* LLAMADA */}
          {activeTab === 'call' && (
            <div className="abar-form">
              <div className="abar-outcome-grid">
                <div className="form-group">
                  <label>Resultado</label>
                  <select value={callOutcome} onChange={e => setCallOutcome(e.target.value)}>
                    {CALL_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Duración (seg)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="ej: 120"
                    value={callDuration}
                    onChange={e => setCallDuration(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Número marcado</label>
                <input
                  type="tel"
                  placeholder="+52 55 1234 5678"
                  value={callPhone}
                  onChange={e => setCallPhone(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Notas de la llamada</label>
                <textarea
                  rows={2}
                  placeholder="¿Qué pasó en la llamada?"
                  value={callNotes}
                  onChange={e => setCallNotes(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab(null)}>Cancelar</button>
                <button className="btn btn-primary btn-sm" onClick={saveCall} disabled={loading}>
                  {loading ? 'Registrando…' : 'Registrar llamada'}
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

          {/* SEGUIMIENTO */}
          {activeTab === 'followup' && (
            <div className="abar-form">
              <div className="abar-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Fecha y hora del seguimiento *</label>
                  <input
                    type="datetime-local"
                    value={followupDate}
                    onChange={e => setFollowupDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Notas para el seguimiento</label>
                <textarea
                  rows={2}
                  placeholder="¿Qué debes hacer en este seguimiento?"
                  value={followupNotes}
                  onChange={e => setFollowupNotes(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab(null)}>Cancelar</button>
                <button className="btn btn-primary btn-sm" onClick={saveFollowup} disabled={loading || !followupDate}>
                  {loading ? 'Programando…' : 'Programar seguimiento'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
