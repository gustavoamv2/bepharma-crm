import React, { useState } from 'react'
import { Phone, Clock } from 'lucide-react'
import { useQuery } from 'react-query'
import { hubspot, zadarma } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

const CALL_OUTCOMES = [
  { value: 'CONNECTED', label: 'Contesto' },
  { value: 'NO_ANSWER', label: 'No contesto' },
  { value: 'LEFT_VOICEMAIL', label: 'Buzon de voz' },
  { value: 'BUSY', label: 'Ocupado' },
  { value: 'WRONG_NUMBER', label: 'Numero equivocado' },
]

function toErrorText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.message || value.error || JSON.stringify(value)
}

export default function CallWidget({ phone, contactName, objectType, objectId, onActivityLogged }) {
  const { addToast: toast } = useToast()
  const { user } = useAuth()
  const [to, setTo] = useState(phone || '')
  const [calling, setCalling] = useState(false)
  const [callStatus, setCallStatus] = useState('')
  const [showLogForm, setShowLogForm] = useState(false)
  const [savingLog, setSavingLog] = useState(false)
  const [callStartedAt, setCallStartedAt] = useState(null)
  const [callOutcome, setCallOutcome] = useState('CONNECTED')
  const [callDuration, setCallDuration] = useState('')
  const [callNotes, setCallNotes] = useState('')

  const { data: callHistory } = useQuery(
    ['zadarma-calls'],
    () => zadarma.getCalls({ limit: 10 }),
    { staleTime: 5 * 60 * 1000 }
  )

  const handleCall = async () => {
    if (!to) return toast('Ingresa un numero de telefono', 'error')

    const from = user?.sipExtension
    if (!from) return toast('Tu usuario no tiene extension SIP configurada. Pide al supervisor que la configure en Admin.', 'error')

    setCalling(true)
    setCallStatus('')

    try {
      const result = await zadarma.call(from, to)
      const message = result?.message || `Solicitud enviada a la extension ${from}. Contesta para conectar con ${contactName || to}.`
      setCallStatus(message)
      setCallStartedAt(Date.now())
      setShowLogForm(!!objectType && !!objectId)
      toast(message, 'success')
    } catch (e) {
      const data = e.response?.data
      const msg = [toErrorText(data?.error), toErrorText(data?.details)]
        .filter(Boolean)
        .join(' - ') || e.message
      setCallStatus(msg)
      toast('Error al iniciar llamada: ' + msg, 'error')
    } finally {
      setCalling(false)
    }
  }

  const useElapsedDuration = () => {
    if (!callStartedAt) return
    const elapsed = Math.max(0, Math.round((Date.now() - callStartedAt) / 1000))
    setCallDuration(String(elapsed))
  }

  const saveManualCall = async () => {
    if (!objectType || !objectId) return toast('No hay registro asociado para guardar la llamada', 'error')
    setSavingLog(true)
    try {
      await hubspot.logCall({
        objectType,
        objectId,
        outcome: callOutcome,
        durationSeconds: callDuration ? parseInt(callDuration, 10) : 0,
        phoneNumber: to.trim(),
        notes: callNotes.trim(),
      })
      toast('Llamada registrada en HubSpot', 'success')
      setShowLogForm(false)
      setCallNotes('')
      setCallDuration('')
      setCallOutcome('CONNECTED')
      onActivityLogged?.()
    } catch (e) {
      const data = e.response?.data
      const msg = [toErrorText(data?.error), toErrorText(data?.details)]
        .filter(Boolean)
        .join(' - ') || e.message || 'Error al registrar llamada'
      toast('Error al registrar llamada: ' + msg, 'error')
    } finally {
      setSavingLog(false)
    }
  }

  const calls = callHistory?.stats || []

  return (
    <div className="call-widget">
      <h3><Phone size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />Click-to-Call</h3>
      <div className="call-phone-input">
        <input
          value={to}
          onChange={e => setTo(e.target.value)}
          placeholder="+52 55 0000 0000"
        />
        <button className="btn btn-call" onClick={handleCall} disabled={calling}>
          {calling ? '...' : 'Llamar'}
        </button>
      </div>

      {callStatus && (
        <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.4, color: '#b0bec5' }}>
          {callStatus}
        </div>
      )}

      {showLogForm && (
        <div className="call-log-form">
          <div className="form-group">
            <label>Resultado</label>
            <select value={callOutcome} onChange={e => setCallOutcome(e.target.value)}>
              {CALL_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Duracion (seg)</label>
            <div className="call-duration-row">
              <input
                type="number"
                min="0"
                placeholder="ej: 120"
                value={callDuration}
                onChange={e => setCallDuration(e.target.value)}
              />
              <button type="button" className="btn btn-ghost btn-sm" onClick={useElapsedDuration}>
                Usar tiempo
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Numero marcado</label>
            <input
              type="tel"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="+52 55 0000 0000"
            />
          </div>

          <div className="form-group">
            <label>Notas de la llamada</label>
            <textarea
              rows={3}
              placeholder="Que se converso, proximo paso, objeciones o contexto relevante."
              value={callNotes}
              onChange={e => setCallNotes(e.target.value)}
            />
          </div>

          <div className="call-log-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowLogForm(false)}>
              Cerrar
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveManualCall} disabled={savingLog}>
              {savingLog ? 'Guardando...' : 'Guardar llamada'}
            </button>
          </div>
        </div>
      )}

      {calls.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: '#90caf9', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            <Clock size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Historial reciente
          </div>
          {calls.slice(0, 5).map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #1a2d42', fontSize: 12 }}>
              <span style={{ color: '#b0bec5' }}>{c.destination || c.pbx_call_id || '-'}</span>
              <span style={{ color: '#546e7a' }}>{c.callstart ? format(parseISO(c.callstart), 'dd MMM HH:mm', { locale: es }) : '-'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
