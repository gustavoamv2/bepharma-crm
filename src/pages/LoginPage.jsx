import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

const ROLE_LABELS = { supervisor: 'Supervisor', operator: 'Operador' }

export default function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password)
      nav('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Error al iniciar sesión')
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
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
            Be<span style={{ color: '#4fc3f7' }}>Pharma</span>
          </div>
          <div style={{ fontSize: 13, color: '#546e7a', marginTop: 4 }}>CRM · Sistema de gestión</div>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: '32px 28px',
          boxShadow: '0 20px 60px rgba(0,0,0,.4)'
        }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20, color: '#172b4d' }}>
            Iniciar sesión
          </h2>

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

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••"
                autoComplete="current-password"
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
              {loading ? 'Iniciando sesión…' : 'Entrar'}
            </button>
          </form>
        </div>

        {/* Hint usuarios */}
        <div style={{ marginTop: 20, background: 'rgba(255,255,255,.06)', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: '#546e7a', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Usuarios disponibles
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {[
              { u: 'roberto', r: 'Supervisor' },
              { u: 'yesenia', r: 'Supervisora' },
              { u: 'angel', r: 'Operador' },
              { u: 'carlos', r: 'Operador' },
              { u: 'gracie', r: 'Operadora' },
              { u: 'sara', r: 'Operadora' },
            ].map(item => (
              <button
                key={item.u}
                onClick={() => setUsername(item.u)}
                style={{
                  background: username === item.u ? 'rgba(79,195,247,.15)' : 'transparent',
                  border: `1px solid ${username === item.u ? '#4fc3f7' : 'rgba(255,255,255,.1)'}`,
                  borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
                  textAlign: 'left', color: username === item.u ? '#4fc3f7' : '#90a4ae'
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600 }}>{item.u}</div>
                <div style={{ fontSize: 10, opacity: .7 }}>{item.r}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
