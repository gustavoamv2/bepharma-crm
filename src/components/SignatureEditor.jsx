import React, { useState, useEffect, useRef } from 'react'
import { X, Image as ImageIcon, Smile, Bold, Italic, Save } from 'lucide-react'
import axios from 'axios'
import { useToast } from '../hooks/useToast'

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.5)',
  zIndex: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
}

const modal = {
  background: '#fff',
  borderRadius: 10,
  width: '100%',
  maxWidth: 560,
  boxShadow: '0 20px 60px rgba(0,0,0,.3)',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '90vh',
}

const IMAGE_MAX_BYTES = 180 * 1024 // ~180KB — la firma completa tiene tope de ~300KB en el backend

// Selector amplio de iconos/emojis — se insertan como texto unicode (compatibles
// con cualquier cliente de correo, a diferencia de SVG que Outlook no siempre renderiza)
const EMOJI_GROUPS = [
  { label: 'Contacto', items: ['📞', '📱', '✉️', '🌐', '📍', '💼', '🏢', '🕒'] },
  { label: 'Social', items: ['🔗', '💬', '⭐', '✅', '📌', '🔵', '📷', '▶️'] },
  { label: 'General', items: ['😀', '🙂', '👍', '🎉', '📅', '📎', '🔥', '💡'] },
  { label: 'Flechas / separadores', items: ['➡️', '↳', '•', '—', '·', '✦', '★', '»'] },
]

export default function SignatureEditor({ onClose, onSaved }) {
  const { addToast: toast } = useToast()
  const editorRef = useRef(null)
  const fileInputRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [persisted, setPersisted] = useState(true)

  useEffect(() => {
    axios.get('/api/email/signature')
      .then(r => {
        if (editorRef.current) editorRef.current.innerHTML = r.data?.html || ''
        setPersisted(r.data?.persisted !== false)
      })
      .catch(e => toast('No se pudo cargar la firma: ' + (e.response?.data?.error || e.message), 'error'))
      .finally(() => setLoading(false))
  }, [])

  const focusEditor = () => editorRef.current?.focus()

  const exec = (cmd, value) => {
    focusEditor()
    document.execCommand(cmd, false, value)
  }

  const insertEmoji = (emoji) => {
    focusEditor()
    document.execCommand('insertText', false, emoji)
  }

  const handleImagePick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return toast('Selecciona un archivo de imagen', 'error')
    if (file.size > IMAGE_MAX_BYTES) return toast(`Imagen muy pesada (máx. ${Math.round(IMAGE_MAX_BYTES / 1024)}KB) — usa una más chica o comprimida`, 'error')
    const reader = new FileReader()
    reader.onload = () => {
      focusEditor()
      document.execCommand('insertHTML', false, `<img src="${reader.result}" style="max-height:70px;max-width:220px;vertical-align:middle" />`)
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    const html = editorRef.current?.innerHTML?.trim() || ''
    setSaving(true)
    try {
      const r = await axios.put('/api/email/signature', { html })
      toast(
        r.data?.persisted
          ? 'Firma guardada'
          : 'Firma guardada, pero solo en este servidor (temporal) — falta configurar almacenamiento persistente',
        r.data?.persisted ? 'success' : 'default'
      )
      onSaved?.(html)
      onClose()
    } catch (e) {
      toast('Error al guardar firma: ' + (e.response?.data?.error || e.message), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Editar firma de email</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b778c', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {!persisted && !loading && (
          <div style={{ padding: '8px 18px', background: '#fffae6', borderBottom: '1px solid #ffe58f', fontSize: 12, color: '#8a6914' }}>
            El almacenamiento persistente (Vercel KV) no está configurado — la firma puede perderse. Avisa al administrador.
          </div>
        )}

        <div style={{ padding: '10px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => exec('bold')} title="Negrita">
            <Bold size={13} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => exec('italic')} title="Cursiva">
            <Italic size={13} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} title="Insertar imagen" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <ImageIcon size={13} /> Imagen
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowEmoji(s => !s)} title="Insertar icono" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Smile size={13} /> Iconos
          </button>
        </div>

        {showEmoji && (
          <div style={{ padding: '10px 18px', borderBottom: '1px solid #e2e8f0', maxHeight: 160, overflow: 'auto' }}>
            {EMOJI_GROUPS.map(group => (
              <div key={group.label} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: '#6b778c', fontWeight: 600, marginBottom: 4 }}>{group.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {group.items.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      style={{
                        border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc',
                        cursor: 'pointer', fontSize: 16, padding: '4px 8px', lineHeight: 1,
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
          {loading ? (
            <div className="loading">Cargando…</div>
          ) : (
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              style={{
                minHeight: 160, border: '1px solid #e2e8f0', borderRadius: 8, padding: 12,
                fontSize: 13, lineHeight: 1.6, outline: 'none',
              }}
            />
          )}
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
            Esta firma se agrega automáticamente al final de cada correo que redactes desde un Deal.
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8, background: '#f8fafc' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={13} />
            {saving ? 'Guardando...' : 'Guardar firma'}
          </button>
        </div>
      </div>
    </div>
  )
}
