import React, { useState, useEffect } from 'react'
import { X, Send, Mail } from 'lucide-react'
import axios from 'axios'
import { useToast } from '../hooks/useToast'

// Estilos del modal (inline para no depender del CSS global)
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20
}
const modal = {
  background: '#fff', borderRadius: 10, width: '100%', maxWidth: 620,
  boxShadow: '0 20px 60px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column',
  maxHeight: '90vh'
}

export default function EmailComposer({ defaultTo = '', defaultSubject = '', contactId, dealId, companyId, onClose }) {
  const { addToast: toast } = useToast()
  const [to, setTo] = useState(defaultTo)
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [smtpOk, setSmtpOk] = useState(null)

  // Verificar SMTP al abrir
  useEffect(() => {
    axios.get('/api/email/verify')
      .then(r => setSmtpOk(r.data.ok))
      .catch(() => setSmtpOk(false))
  }, [])

  const handleSend = async () => {
    if (!to.trim()) return toast('Ingresa el destinatario', 'error')
    if (!subject.trim()) return toast('Ingresa el asunto', 'error')
    if (!body.trim()) return toast('El cuerpo del email no puede estar vacío', 'error')

    setSending(true)
    try {
      await axios.post('/api/email/send', {
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
        contactId,
        dealId,
        companyId
      })
      toast('✉️ Email enviado y registrado en HubSpot', 'success')
      onClose()
    } catch (e) {
      const msg = e.response?.data?.error || e.message
      toast('Error al enviar: ' + msg, 'error')
    } finally {
      setSending(false)
    }
  }

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
            <Mail size={16} color="#0052cc" />
            Redactar email
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b778c', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Alerta SMTP */}
        {smtpOk === false && (
          <div style={{ padding: '10px 18px', background: '#fffae6', borderBottom: '1px solid #ffe58f', fontSize: 12, color: '#8a6914' }}>
            ⚠️ El servidor de email no está configurado. Agrega <code>EMAIL_USER</code> y <code>EMAIL_PASS</code> en tu archivo <code>.env</code> y reinicia el servidor.
          </div>
        )}

        {/* Cuerpo del formulario */}
        <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Para */}
          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: 8, gap: 10 }}>
            <span style={{ fontSize: 12, color: '#6b778c', fontWeight: 600, minWidth: 50 }}>Para</span>
            <input
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="contacto@empresa.com"
              style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, padding: 0 }}
            />
          </div>

          {/* Asunto */}
          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: 8, gap: 10 }}>
            <span style={{ fontSize: 12, color: '#6b778c', fontWeight: 600, minWidth: 50 }}>Asunto</span>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Asunto del email"
              style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, padding: 0 }}
            />
          </div>

          {/* Cuerpo */}
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Escribe tu mensaje aquí…"
            rows={10}
            style={{
              border: 'none', outline: 'none', resize: 'vertical', fontSize: 13,
              fontFamily: 'inherit', lineHeight: 1.6, color: '#172b4d',
              minHeight: 200, padding: 0
            }}
          />
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc' }}>
          <span style={{ fontSize: 11, color: '#6b778c' }}>
            {contactId || dealId || companyId
              ? '✓ Se registrará en el timeline de HubSpot'
              : 'No asociado a ningún registro de HubSpot'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSend}
              disabled={sending || smtpOk === false}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Send size={13} />
              {sending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
