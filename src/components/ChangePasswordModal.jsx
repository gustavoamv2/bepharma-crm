import React, { useState, useEffect } from 'react'
import { X, KeyRound } from 'lucide-react'
import { authApi } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'

const MIN_LENGTH = 8

export default function ChangePasswordModal({ onClose }) {
  const { addToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSave = async () => {
    if (!currentPassword) return addToast('Escribe tu contraseña actual', 'error')
    if (newPassword.length < MIN_LENGTH) return addToast(`La nueva contraseña debe tener al menos ${MIN_LENGTH} caracteres`, 'error')
    if (newPassword !== confirmPassword) return addToast('Las contraseñas nuevas no coinciden', 'error')

    setLoading(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      addToast('Contraseña actualizada correctamente', 'success')
      onClose()
    } catch (e) {
      addToast(e.response?.data?.error || 'Error al cambiar la contraseña', 'error')
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
        background: '#fff', borderRadius: 12, width: 420, maxWidth: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,.25)', overflow: 'hidden',
      }}>
        <div style={{
          background: '#0a1929', padding: '16px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontWeight: 700, fontSize: 15 }}>
            <KeyRound size={16} /> Cambiar contraseña
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#78909c', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Contraseña actual</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Nueva contraseña</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder={`Mínimo ${MIN_LENGTH} caracteres`}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Confirmar nueva contraseña</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={loading || !currentPassword || !newPassword || !confirmPassword}
            >
              {loading ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
