import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../hooks/useApi'

const MIN_LENGTH = 8

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const nav = useNavigate()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!token) return setError('Este link no es válido. Solicita uno nuevo.')
    if (newPassword.length < MIN_LENGTH) return setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`)
    if (newPassword !== confirmPassword) return setError('Las contraseñas no coinciden')

    setLoading(true)
    try {
      await authApi.resetPassword(token, newPassword)
      setDone(true)
      setTimeout(() => nav('/login'), 2500)
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo restablecer la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0a1929 0%, #0d2137 50%, #0a1929 100%)'
    }}>
      <div style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/logo.png" alt="BePharma" style={{ width: 64, height: 64, objectFit: 'contain', marginBottom: 12 }} />
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
            Be<span style={{ color: '#4fc3f7' }}>Pharma</span>
          </div>
          <div style={{ fontSize: 13, color: '#546e7a', marginTop: 4 }}>CRM · Sistema de gestión</div>
        </div>

        <div style={{
          background: '#fff', borderRadius: 12, padding: '32px 28px',
          boxShadow: '0 20px 60px rgba(0,0,0,.4)'
        }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#172b4d' }}>
            Elegir nueva contraseña
          </h2>

          {!token && (
            <div style={{
              background: '#ffebe6', border: '1px solid #ffbdad', borderRadius: 6,
              padding: '12px 14px', fontSize: 13, color: '#bf2600', marginTop: 12, lineHeight: 1.5
            }}>
              Este link no es válido o le falta el token. Solicita uno nuevo desde
              "¿Olvidaste tu contraseña?" en la pantalla de inicio de sesión.
            </div>
          )}

          {done ? (
            <div style={{
              background: '#e3fcef', border: '1px solid #abf5d1', borderRadius: 6,
              padding: '12px 14px', fontSize: 13, color: '#006644', marginTop: 12, lineHeight: 1.5
            }}>
              Contraseña actualizada. Redirigiendo a iniciar sesión…
            </div>
          ) : token && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Nueva contraseña</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder={`Mínimo ${MIN_LENGTH} caracteres`}
                  autoComplete="new-password"
                  autoFocus
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Confirmar contraseña</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repite la contraseña"
                  autoComplete="new-password"
                  required
                />
              </div>

              {error && (
                <div style={{
                  background: '#ffebe6', border: '1px solid #ffbdad', borderRadius: 6,
                  padding: '8px 12px', fontSize: 12, color: '#bf2600'
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '10px', marginTop: 4, fontSize: 14 }}
                disabled={loading}
              >
                {loading ? 'Guardando…' : 'Guardar nueva contraseña'}
              </button>

              <Link to="/login" style={{ textAlign: 'center', fontSize: 12, color: '#5e6c84', marginTop: 4 }}>
                Volver a iniciar sesión
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
