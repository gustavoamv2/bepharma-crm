import React, { useState } from 'react'
import { Phone, Clock } from 'lucide-react'
import { useQuery } from 'react-query'
import { zadarma } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export default function CallWidget({ phone, contactName }) {
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
      const msg = [data?.error, data?.details].filter(Boolean).join(' - ') || e.message
      setCallStatus(msg)
      toast('Error al iniciar llamada: ' + msg, 'error')
    } finally {
      setCalling(false)
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
