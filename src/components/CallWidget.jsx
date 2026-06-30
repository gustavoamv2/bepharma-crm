import React, { useState } from 'react'
import { Phone, Clock } from 'lucide-react'
import { useQuery } from 'react-query'
import { hubspot, zadarma } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

function toErrorText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.message || value.error || JSON.stringify(value)
}

function cleanPreview(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function CallWidget({ phone, contactName, objectType, objectId, onActivityLogged }) {
  const { addToast: toast } = useToast()
  const { user } = useAuth()
  const [to, setTo] = useState(phone || '')
  const [calling, setCalling] = useState(false)
  const [callStatus, setCallStatus] = useState('')

  const { data: callHistory } = useQuery(
    ['zadarma-calls'],
    () => zadarma.getCalls({ limit: 10 }),
    { staleTime: 5 * 60 * 1000 }
  )
  const activityQueryKey = ['engagements', objectType, objectId]
  const { data: activityHistory } = useQuery(
    activityQueryKey,
    () => hubspot.getEngagements(objectType, objectId),
    { enabled: !!objectType && !!objectId, staleTime: 30 * 1000 }
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

  const calls = callHistory?.stats || []
  const recentCalls = (activityHistory?.results || [])
    .filter(item => item.type === 'CALL')
    .slice(0, 5)

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

      {!!objectType && !!objectId && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: '#90caf9', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            <Clock size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Historial reciente del registro
          </div>
          {recentCalls.length === 0 ? (
            <div style={{ fontSize: 12, color: '#78909c', padding: '5px 0' }}>
              Sin llamadas registradas todavia
            </div>
          ) : recentCalls.map((c) => {
            const durationSec = c.durationMs ? Math.round(Number(c.durationMs) / 1000) : 0
            const preview = cleanPreview(c.body || c.title)
            return (
              <div key={c.id} style={{ padding: '7px 0', borderBottom: '1px solid #1a2d42', fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: '#b0bec5', fontWeight: 600 }}>Llamada</span>
                  <span style={{ color: '#546e7a', whiteSpace: 'nowrap' }}>
                    {c.createdAt ? format(parseISO(c.createdAt), 'dd MMM HH:mm', { locale: es }) : '-'}
                  </span>
                </div>
                <div style={{ color: '#90a4ae', marginTop: 2 }}>
                  {durationSec ? `${durationSec}s` : '0s'}{preview ? ` - ${preview}` : ''}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!objectType && calls.length > 0 && (
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
