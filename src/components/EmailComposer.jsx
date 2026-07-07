import React, { useState, useEffect, useRef } from 'react'
import {
  X, Send, Mail, Paperclip, PenLine, Bold, Italic, Underline,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered,
} from 'lucide-react'
import axios from 'axios'
import { useToast } from '../hooks/useToast'
import SignatureEditor from './SignatureEditor'

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.45)',
  zIndex: 500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
}

const modal = {
  background: '#fff',
  borderRadius: 10,
  width: '100%',
  maxWidth: 680,
  boxShadow: '0 20px 60px rgba(0,0,0,.25)',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '90vh',
}

// Mantenerse bajo el lÃ­mite de ~2.5MB combinados que valida el backend
// (que a su vez deja margen bajo el lÃ­mite de 4mb del body de la funciÃ³n serverless)
const ATTACH_MAX_TOTAL_BYTES = 2.4 * 1024 * 1024

const FONTS = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
]

const humanSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
  reader.onerror = reject
  reader.readAsDataURL(file)
})

const toolBtn = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '5px 7px',
  borderRadius: 5, color: '#344563', display: 'flex', alignItems: 'center',
}

function ToolbarButton({ onMouseDown, title, children }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onMouseDown() }}
      style={toolBtn}
      onMouseEnter={e => e.currentTarget.style.background = '#f0f1f3'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      {children}
    </button>
  )
}

export default function EmailComposer({ defaultTo = '', defaultSubject = '', emailOptions = [], contactId, dealId, companyId, threadId, inReplyToMessageId, references, onClose, onSent }) {
  const { addToast: toast } = useToast()
  const [to, setTo] = useState(defaultTo || emailOptions[0]?.email || '')
  const [cc, setCc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState(defaultSubject)
  const [sending, setSending] = useState(false)
  const [smtpOk, setSmtpOk] = useState(null)
  const [smtpError, setSmtpError] = useState('')

  const [signatureHtml, setSignatureHtml] = useState('')
  const [showSigEditor, setShowSigEditor] = useState(false)

  const [templates, setTemplates] = useState([]) // [{ id, name, subject, bodyHtml }]
  const [selectedTemplate, setSelectedTemplate] = useState('')

  const [attachments, setAttachments] = useState([]) // [{ id, filename, contentType, sizeBytes, base64 }]
  const fileInputRef = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => {
    axios.get('/api/email/verify', {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('bp_token')}` },
    })
      .then(r => {
        setSmtpOk(r.data.ok)
        setSmtpError(r.data.error || '')
      })
      .catch(e => {
        setSmtpOk(false)
        setSmtpError(e.response?.data?.error || e.message || 'No se pudo verificar el correo')
      })

    axios.get('/api/email/signature')
      .then(r => setSignatureHtml(r.data?.html || ''))
      .catch(() => { /* sin firma configurada â€” no bloquea el composer */ })

    axios.get('/api/email/templates')
      .then(r => setTemplates(r.data?.templates || []))
      .catch(() => { /* sin plantillas â€” no bloquea el composer */ })
  }, [])

  // Destinatarios seleccionados a partir del texto "Para" (permite mÃ¡s de
  // un correo precargado a la vez, separados por coma)
  const toEmails = to.split(',').map(s => s.trim()).filter(Boolean)
  const toggleToEmail = (email) => {
    setTo(toEmails.includes(email)
      ? toEmails.filter(e => e !== email).join(', ')
      : [...toEmails, email].join(', '))
  }

  const applyTemplate = (id) => {
    setSelectedTemplate(id)
    const t = templates.find(t => t.id === id)
    if (!t) return
    if (t.subject) setSubject(t.subject)
    if (bodyRef.current) bodyRef.current.innerHTML = t.bodyHtml || ''
  }

  const saveAsTemplate = async () => {
    const name = window.prompt('Nombre de la plantilla:')
    if (!name?.trim()) return
    const bodyHtml = bodyRef.current?.innerHTML || ''
    const newTemplate = { id: `tmpl_${Date.now()}`, name: name.trim(), subject, bodyHtml }
    const next = [...templates, newTemplate]
    setTemplates(next)
    setSelectedTemplate(newTemplate.id)
    try {
      await axios.put('/api/email/templates', { templates: next })
      toast('Plantilla guardada', 'success')
    } catch (e) {
      toast('No se pudo guardar la plantilla: ' + (e.response?.data?.error || e.message), 'error')
    }
  }

  const deleteTemplate = async (id) => {
    const next = templates.filter(t => t.id !== id)
    setTemplates(next)
    if (selectedTemplate === id) setSelectedTemplate('')
    try {
      await axios.put('/api/email/templates', { templates: next })
      toast('Plantilla eliminada', 'success')
    } catch (e) {
      toast('No se pudo eliminar la plantilla: ' + (e.response?.data?.error || e.message), 'error')
    }
  }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !showSigEditor) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, showSigEditor])

  const totalAttachBytes = attachments.reduce((sum, a) => sum + a.sizeBytes, 0)

  const handleFilesPick = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return

    let runningTotal = totalAttachBytes
    for (const file of files) {
      if (runningTotal + file.size > ATTACH_MAX_TOTAL_BYTES) {
        toast(`"${file.name}" no cabe â€” mÃ¡x. ${humanSize(ATTACH_MAX_TOTAL_BYTES)} combinados entre todos los adjuntos`, 'error')
        continue
      }
      try {
        const base64 = await fileToBase64(file)
        setAttachments(prev => [...prev, {
          id: `${file.name}_${file.size}_${Date.now()}`,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          base64,
        }])
        runningTotal += file.size
      } catch {
        toast(`No se pudo leer "${file.name}"`, 'error')
      }
    }
  }

  const removeAttachment = (id) => setAttachments(prev => prev.filter(a => a.id !== id))

  const exec = (cmd, value) => {
    bodyRef.current?.focus()
    document.execCommand(cmd, false, value)
  }

  const handleSend = async () => {
    const bodyHtml = bodyRef.current?.innerHTML || ''
    const bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    if (!to.trim()) return toast('Ingresa el destinatario', 'error')
    if (!subject.trim()) return toast('Ingresa el asunto', 'error')
    if (!bodyText) return toast('El cuerpo del email no puede estar vacio', 'error')

    setSending(true)
    try {
      const r = await axios.post('/api/email/send', {
        to: to.trim(),
        cc: cc.trim(),
        subject: subject.trim(),
        bodyHtml,
        signatureHtml: signatureHtml || undefined,
        attachments: attachments.map(a => ({ filename: a.filename, contentType: a.contentType, content: a.base64 })),
        contactId,
        dealId,
        companyId,
        threadId,
        inReplyToMessageId,
        references,
      })
      if (r.data?.hubspotLogged) {
        if (r.data?.attachmentsFailed?.length) {
          toast(`Email enviado y registrado, pero estos adjuntos no se pudieron subir a HubSpot: ${r.data.attachmentsFailed.join(', ')}`, 'default')
        } else {
          toast('Email enviado y registrado en HubSpot', 'success')
        }
        onSent?.()
      } else {
        toast('Email enviado, pero no se pudo registrar en HubSpot' + (r.data?.hubspotLogError ? `: ${r.data.hubspotLogError}` : ''), 'error')
      }
      onClose()
    } catch (e) {
      const raw = e.response?.data?.error || e.message
      const msg = typeof raw === 'object' ? JSON.stringify(raw) : String(raw || 'Error desconocido')
      toast('Error al enviar: ' + msg, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && !showSigEditor && onClose()}>
      <div style={modal}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
            <Mail size={16} color="#0052cc" />
            Redactar email
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b778c', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {smtpOk === false && (
          <div style={{ padding: '10px 18px', background: '#fffae6', borderBottom: '1px solid #ffe58f', fontSize: 12, color: '#8a6914' }}>
            {smtpError === 'no_config' ? (
              <>Tu correo no esta configurado. Pide al administrador que configure tus credenciales en <strong>Admin &gt; Usuarios &gt; Email</strong>.</>
            ) : (
              <>Microsoft 365 rechazo la conexion SMTP: <strong>{smtpError || 'verifica SMTP AUTH y credenciales'}</strong></>
            )}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Chips de selecciÃ³n rÃ¡pida de email â€” clic para agregar/quitar,
              permite seleccionar mÃ¡s de un destinatario precargado a la vez */}
          {emailOptions.length > 1 && (
            <div style={{ paddingBottom: 10, borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, color: '#6b778c', fontWeight: 600, marginBottom: 6 }}>
                Enviar a (clic para agregar/quitar):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {emailOptions.map(opt => {
                  const active = toEmails.includes(opt.email)
                  return (
                    <button
                      key={opt.email}
                      type="button"
                      onClick={() => toggleToEmail(opt.email)}
                      style={{
                        padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                        border: `1px solid ${active ? '#0052cc' : '#dfe1e6'}`,
                        background: active ? '#e6f0ff' : '#f4f5f7',
                        color: active ? '#0052cc' : '#344563',
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {active ? 'âœ“ ' : ''}{opt.label} â€” {opt.email}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Plantillas de email */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 11, color: '#6b778c', fontWeight: 600 }}>Plantilla:</span>
            <select
              value={selectedTemplate}
              onChange={e => applyTemplate(e.target.value)}
              style={{ fontSize: 12, border: '1px solid #dfe1e6', borderRadius: 5, padding: '4px 6px', background: '#fff' }}
            >
              <option value="">â€” Ninguna â€”</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={saveAsTemplate}>
              Guardar como plantilla
            </button>
            {selectedTemplate && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => deleteTemplate(selectedTemplate)}
                style={{ color: '#de350b' }}
              >
                Eliminar plantilla
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: 8, gap: 10 }}>
            <span style={{ fontSize: 12, color: '#6b778c', fontWeight: 600, minWidth: 40 }}>Para</span>
            <input
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="contacto@empresa.com, otro@empresa.com"
              style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, padding: 0 }}
            />
            {!showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b778c', fontSize: 12, padding: 0 }}
              >
                Cc
              </button>
            )}
          </div>

          {showCc && (
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: 8, gap: 10 }}>
              <span style={{ fontSize: 12, color: '#6b778c', fontWeight: 600, minWidth: 40 }}>Cc</span>
              <input
                value={cc}
                onChange={e => setCc(e.target.value)}
                placeholder="otro@empresa.com, otro2@empresa.com"
                style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, padding: 0 }}
              />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: 8, gap: 10 }}>
            <span style={{ fontSize: 12, color: '#6b778c', fontWeight: 600, minWidth: 40 }}>Asunto</span>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Asunto del email"
              style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, padding: 0 }}
            />
          </div>

          {/* â”€â”€ Barra de herramientas de formato â”€â”€ */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
            padding: '4px 0', borderBottom: '1px solid #e2e8f0',
          }}>
            <select
              defaultValue={FONTS[0].value}
              onMouseDown={() => bodyRef.current?.focus()}
              onChange={e => exec('fontName', e.target.value)}
              style={{ fontSize: 12, border: '1px solid #dfe1e6', borderRadius: 5, padding: '4px 6px', background: '#fff', marginRight: 4 }}
            >
              {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>

            <ToolbarButton title="Negrita" onMouseDown={() => exec('bold')}><Bold size={14} /></ToolbarButton>
            <ToolbarButton title="Cursiva" onMouseDown={() => exec('italic')}><Italic size={14} /></ToolbarButton>
            <ToolbarButton title="Subrayado" onMouseDown={() => exec('underline')}><Underline size={14} /></ToolbarButton>

            <div style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 4px' }} />

            <ToolbarButton title="Alinear izquierda" onMouseDown={() => exec('justifyLeft')}><AlignLeft size={14} /></ToolbarButton>
            <ToolbarButton title="Centrar" onMouseDown={() => exec('justifyCenter')}><AlignCenter size={14} /></ToolbarButton>
            <ToolbarButton title="Alinear derecha" onMouseDown={() => exec('justifyRight')}><AlignRight size={14} /></ToolbarButton>
            <ToolbarButton title="Justificar" onMouseDown={() => exec('justifyFull')}><AlignJustify size={14} /></ToolbarButton>

            <div style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 4px' }} />

            <ToolbarButton title="ViÃ±etas" onMouseDown={() => exec('insertUnorderedList')}><List size={14} /></ToolbarButton>
            <ToolbarButton title="NumeraciÃ³n" onMouseDown={() => exec('insertOrderedList')}><ListOrdered size={14} /></ToolbarButton>
          </div>

          <div
            ref={bodyRef}
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Escribe tu mensaje aqui..."
            className="email-body-editable"
            style={{
              outline: 'none',
              fontSize: 13,
              fontFamily: 'Arial, sans-serif',
              lineHeight: 1.6,
              color: '#172b4d',
              minHeight: 180,
              padding: '4px 0',
            }}
          />

          {/* â”€â”€ Adjuntos â”€â”€ */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => fileInputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <Paperclip size={13} /> Adjuntar archivo
              </button>
              {attachments.length > 0 && (
                <span style={{ fontSize: 11, color: '#6b778c' }}>{humanSize(totalAttachBytes)} / {humanSize(ATTACH_MAX_TOTAL_BYTES)}</span>
              )}
            </div>
            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFilesPick} />
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                {attachments.map(a => (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#f4f5f7', borderRadius: 6, padding: '5px 10px', fontSize: 12,
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
                      ðŸ“Ž {a.filename} <span style={{ color: '#94a3b8' }}>({humanSize(a.sizeBytes)})</span>
                    </span>
                    <button onClick={() => removeAttachment(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b778c', padding: 2, flexShrink: 0 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* â”€â”€ Firma â”€â”€ */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: signatureHtml ? 6 : 0 }}>
              <span style={{ fontSize: 11, color: '#6b778c', fontWeight: 600 }}>Firma (se agrega automÃ¡ticamente)</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowSigEditor(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <PenLine size={13} /> {signatureHtml ? 'Editar firma' : 'Crear firma'}
              </button>
            </div>
            {signatureHtml && (
              <div
                style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, fontSize: 12, background: '#fafbfc' }}
                dangerouslySetInnerHTML={{ __html: signatureHtml }}
              />
            )}
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc' }}>
          <span style={{ fontSize: 11, color: '#6b778c' }}>
            {contactId || dealId || companyId
              ? 'Se registrara en el timeline de HubSpot'
              : 'No asociado a ningun registro de HubSpot'}
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
              {sending ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>

      {showSigEditor && (
        <SignatureEditor
          onClose={() => setShowSigEditor(false)}
          onSaved={(html) => setSignatureHtml(html)}
        />
      )}
    </div>
  )
}


