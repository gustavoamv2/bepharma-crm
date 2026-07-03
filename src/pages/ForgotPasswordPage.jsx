import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../hooks/useApi'

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.forgotPassword(username.trim())
      // Respuesta siempre generica (el backend no revela si el usuario existe
      // o si tiene correo configurado) -- por eso siempre mostramos exito.
      setSent(true)
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo procesar la solicitud')
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
            Recuperar contraseña
          </h2>

          {sent ? (
            <>
              <div style={{
                background: '#e3fcef', border: '1px solid #abf5d1', borderRadius: 6,
                padding: '12px 14px', fontSize: 13, color: '#006644', marginTop: 12, lineHeight: 1.5
              }}>
                Si el usuario existe y tiene un correo configurado, te llegará un link para
                elegir una nueva contraseña. El link expira en 30 minutos.
              </div>
              <Link to="/login" className="btn btn-primary" style={{
                width: '100%', justifyContent: 'center', padding: '10px', marginTop: 16, fontSize: 14,
                display: 'flex', textDecoration: 'none'
              }}>
                Volver a iniciar sesión
              </Link>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: '#5e6c84', marginBottom: 20 }}>
                Escribe tu usuario y te mandaremos un link para restablecer tu contraseña.
              </p>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Usuario</label>
                  <input
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="roberto, yesenia, angel…"
                    autoComplete="username"
                    autoFocus
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
                  {loading ? 'Enviando…' : 'Enviar link de recuperación'}
                </button>

                <Link to="/login" style={{ textAlign: 'center', fontSize: 12, color: '#5e6c84', marginTop: 4 }}>
                  Volver a iniciar sesión
                </Link>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
