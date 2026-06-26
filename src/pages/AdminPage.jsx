import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { Settings, Phone, User, Check, AlertTriangle, Mail } from 'lucide-react'
import { admin } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'

// Tokens Zadarma por extensión (del archivo Token Hubspot.txt)
const ZADARMA_TOKENS = {
  '100': '545494-100 · c20108dd100b41b51afffd61944bb9cd',  // Carlos
  '101': '545494-101 · 53f4d635b7409046046d7666037528fe',  // Angel
  '102': '545494-102 · 8f58fa2e32f60f00ecbc59d47f84418d',  // Sara
  '103': '545494-103 · 45703acc3d7e78bdc360d347a8b7c74c',  // Gracie
  '104': '545494-104 · UjHqpi8FR9',                         // Yesenia
}

const ROLE_BADGE = {
  supervisor: { label: '⭐ Supervisor', bg: '#e3fcef', color: '#006644' },
  operator:   { label: '👤 Operador',   bg: '#deebff', color: '#0052cc' },
}

export default function AdminPage() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const qc = useQueryClient()
  const [editingUser, setEditingUser] = useState(null)
  const [editingEmail, setEditingEmail] = useState(null)
  const [sipValue, setSipValue] = useState('')
  const [emailUserValue, setEmailUserValue] = useState('')
  const [emailPassValue, setEmailPassValue] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: users, isLoading } = useQuery('admin-users', admin.getUsers)

  if (user?.role !== 'supervisor') {
    return (
      <>
        <Topbar title="Administración" />
        <div className="content">
          <div className="error-msg">Solo supervisores pueden acceder a esta sección.</div>
        </div>
      </>
    )
  }

  const startEdit = (u) => {
    setEditingUser(u.username)
    setSipValue(u.sipExtension || '')
  }

  const saveExt = async (username) => {
    setSaving(true)
    try {
      await admin.updateSip(username, sipValue)
      qc.invalidateQueries('admin-users')
      addToast('Extensión actualizada', 'success')
      setEditingUser(null)
    } catch (e) {
      addToast('Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  const startEditEmail = (u) => {
    setEditingEmail(u.username)
    setEmailUserValue(u.emailUser || '')
    setEmailPassValue('')
  }

  const saveEmail = async (username) => {
    if (!emailUserValue) return addToast('Ingresa el correo', 'error')
    if (!emailPassValue) return addToast('Ingresa la contraseña', 'error')
    setSaving(true)
    try {
      await admin.updateEmail(username, emailUserValue, emailPassValue)
      qc.invalidateQueries('admin-users')
      addToast('Correo configurado', 'success')
      setEditingEmail(null)
    } catch (e) {
      addToast('Error al guardar correo', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Topbar title="Administración" />
      <div className="content">

        {/* Usuarios y extensiones Zadarma */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Phone size={15} style={{ color: '#ff8b00' }} /> Configuración Zadarma — Extensiones SIP
            </h2>
          </div>
          {isLoading ? (
            <div className="loading">Cargando usuarios…</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>HubSpot Owner ID</th>
                    <th>Extensión SIP</th>
                    <th>Token Zadarma</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(users || []).map(u => {
                    const badge = ROLE_BADGE[u.role]
                    const isEditing = editingUser === u.username
                    return (
                      <tr key={u.username}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: '#6b778c' }}>@{u.username}</div>
                        </td>
                        <td>
                          <span style={{ background: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                            {badge.label}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#546e7a' }}>{u.ownerId}</td>
                        <td>
                          {isEditing ? (
                            <input
                              value={sipValue}
                              onChange={e => setSipValue(e.target.value)}
                              placeholder="ej: 100"
                              style={{ width: 80, padding: '4px 8px', border: '1px solid #4fc3f7', borderRadius: 4, fontSize: 13 }}
                              autoFocus
                            />
                          ) : (
                            <span style={{ fontWeight: 600, color: u.sipExtension ? '#4fc3f7' : '#6b778c' }}>
                              {u.sipExtension || '—'}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 11, color: '#546e7a', fontFamily: 'monospace' }}>
                          {ZADARMA_TOKENS[u.sipExtension] || '—'}
                        </td>
                        <td>
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-primary btn-sm" onClick={() => saveExt(u.username)} disabled={saving}>
                                <Check size={12} /> {saving ? '…' : 'Guardar'}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditingUser(null)}>×</button>
                            </div>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => startEdit(u)}>
                              Editar ext.
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Correo por usuario */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail size={15} style={{ color: '#42a5f5' }} /> Configuración de Correo por Usuario
            </h2>
            <span style={{ fontSize: 11, color: '#6b778c' }}>Outlook / Office 365 · smtp.office365.com:587</span>
          </div>
          {isLoading ? (
            <div className="loading">Cargando usuarios…</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Correo configurado</th>
                    <th>Contraseña</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(users || []).map(u => {
                    const isEdit = editingEmail === u.username
                    return (
                      <tr key={u.username}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: '#6b778c' }}>@{u.username}</div>
                        </td>
                        <td>
                          {isEdit ? (
                            <input
                              type="email"
                              value={emailUserValue}
                              onChange={e => setEmailUserValue(e.target.value)}
                              placeholder="usuario@tissue.cmpc.cl"
                              style={{ width: 220, padding: '4px 8px', border: '1px solid #42a5f5', borderRadius: 4, fontSize: 13 }}
                              autoFocus
                            />
                          ) : (
                            <span style={{ color: u.emailUser ? '#172b4d' : '#adb5bd', fontSize: 13 }}>
                              {u.emailUser || '— sin configurar —'}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEdit ? (
                            <input
                              type="password"
                              value={emailPassValue}
                              onChange={e => setEmailPassValue(e.target.value)}
                              placeholder="Contraseña de Outlook"
                              style={{ width: 180, padding: '4px 8px', border: '1px solid #42a5f5', borderRadius: 4, fontSize: 13 }}
                            />
                          ) : (
                            <span style={{ color: u.emailUser ? '#00875a' : '#adb5bd', fontSize: 12 }}>
                              {u.emailUser ? '●●●●●●●●' : '—'}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEdit ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-primary btn-sm" onClick={() => saveEmail(u.username)} disabled={saving}>
                                <Check size={12} /> {saving ? '…' : 'Guardar'}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditingEmail(null)}>×</button>
                            </div>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => startEditEmail(u)}>
                              {u.emailUser ? 'Cambiar' : 'Configurar'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Instrucciones de integración Zadarma */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Softphone / app de escritorio */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Phone size={14} style={{ color: '#4fc3f7' }} />
                Paso 1 · App Zadarma (softphone)
              </h2>
            </div>
            <div className="card-body" style={{ fontSize: 13, lineHeight: 1.8, color: '#546e7a' }}>
              <p style={{ marginBottom: 10 }}>Descarga e instala la app Zadarma en tu computadora para hacer y recibir llamadas:</p>
              <ol style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Ve a <a href="https://zadarma.com/es/support/apps/" target="_blank" rel="noopener" style={{ color: '#4fc3f7' }}>zadarma.com/es/support/apps</a></li>
                <li>Descarga <strong>Zadarma for Windows</strong> (o macOS)</li>
                <li>Instala y abre la app</li>
                <li>En «Cuenta SIP» ingresa:
                  <ul style={{ paddingLeft: 16, marginTop: 4 }}>
                    <li>Servidor: <code>sip.zadarma.com</code></li>
                    <li>Usuario: <code>545494-1XX</code> (tu extensión)</li>
                    <li>Contraseña: el token de tu extensión (tabla arriba)</li>
                  </ul>
                </li>
                <li>Haz clic en <strong>Registrar</strong> — aparecerá luz verde ✓</li>
              </ol>
            </div>
          </div>

          {/* Extensión de Chrome para click-to-call */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Settings size={14} style={{ color: '#66bb6a' }} />
                Paso 2 · Click-to-call desde el CRM
              </h2>
            </div>
            <div className="card-body" style={{ fontSize: 13, lineHeight: 1.8, color: '#546e7a' }}>
              <p style={{ marginBottom: 10 }}>El CRM ya integra click-to-call mediante la API de Zadarma. Cuando hagas clic en «Llamar» dentro de un contacto o evento:</p>
              <ol style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>El CRM llama primero a tu extensión SIP (la app de escritorio sonará)</li>
                <li>Contestas en la app → Zadarma conecta automáticamente con el número del contacto</li>
                <li>La llamada queda registrada en HubSpot como actividad</li>
              </ol>
              <div style={{ marginTop: 12, background: '#e3f2fd', borderRadius: 6, padding: '10px 12px', fontSize: 12 }}>
                <strong>💡 Tip:</strong> Asegúrate de que tu extensión esté configurada en la tabla de arriba y el softphone esté conectado antes de intentar llamadas.
              </div>
            </div>
          </div>

          {/* Configuración Make.com → BePharma */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} style={{ color: '#ff8b00' }} />
                Paso 3 · Integración Make.com → BePharma CRM (registro automático de llamadas)
              </h2>
            </div>
            <div className="card-body" style={{ fontSize: 13, lineHeight: 1.7, color: '#546e7a' }}>
              <p style={{ marginBottom: 14 }}>Cada vez que termina una llamada en Zadarma, Make.com la envía al CRM y queda registrada automáticamente en HubSpot con duración, estado y resumen IA.</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Paso A */}
                <div>
                  <div style={{ fontWeight: 700, color: '#b0bec5', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>A · Activar Zadarma en Make.com</div>
                  <ol style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <li>Ve a <a href="https://my.zadarma.com" target="_blank" rel="noopener" style={{ color: '#4fc3f7' }}>my.zadarma.com</a> → <strong>Configuración → Integraciones y API → Make</strong></li>
                    <li>Haz clic en <strong>Activar</strong> → luego <strong>Ir a ajustes</strong> (abre Make.com)</li>
                    <li>En Make.com: <strong>Scenarios → Create a new scenario</strong></li>
                    <li>Selecciona la aplicación <strong>Zadarma</strong></li>
                    <li>Trigger: <strong>Watch call end</strong></li>
                    <li>Haz clic en <strong>Create webhook</strong> → <strong>Create a connection</strong></li>
                    <li>Ingresa el <strong>Token API</strong> que aparece abajo → <strong>Save</strong></li>
                  </ol>
                  <div style={{ marginTop: 10, background: '#1a2d42', borderRadius: 6, padding: '10px 14px', fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: '#b0bec5', marginBottom: 4 }}>🔑 Token API Make.com ↔ Zadarma:</div>
                    <code style={{ color: '#4fc3f7', wordBreak: 'break-all' }}>056a40ed135ec9bba89775e323886737</code>
                  </div>
                </div>

                {/* Paso B */}
                <div>
                  <div style={{ fontWeight: 700, color: '#b0bec5', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>B · Enviar datos al CRM (módulo HTTP)</div>
                  <ol style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <li>En el escenario, agrega un segundo módulo: <strong>HTTP → Make a request</strong></li>
                    <li>URL: la dirección de tu servidor BePharma:</li>
                    <li style={{ listStyle: 'none', margin: '4px 0' }}>
                      <code style={{ background: '#0d1e2e', padding: '4px 8px', borderRadius: 4, fontSize: 11, color: '#66bb6a', wordBreak: 'break-all' }}>
                        https://[tu-servidor]/api/webhooks/zadarma-call-end
                      </code>
                    </li>
                    <li>Método: <strong>POST</strong> · Content-Type: <strong>application/json</strong></li>
                    <li>Body (JSON) con campos del trigger Zadarma:<br />
                      <code style={{ fontSize: 11, display: 'block', background: '#0d1e2e', padding: '6px 10px', borderRadius: 4, marginTop: 4, whiteSpace: 'pre-wrap', color: '#90caf9' }}>{`{
  "sip": "{{sip}}",
  "caller_id": "{{caller_id}}",
  "called_did": "{{called_did}}",
  "duration": "{{duration}}",
  "status": "{{status}}",
  "record": "{{record}}",
  "call_id_with_rec": "{{call_id_with_rec}}",
  "call_start": "{{call_start}}",
  "internal": "{{internal}}"
}`}</code>
                    </li>
                    <li>Guarda y <strong>activa el escenario</strong> (botón ▶)</li>
                  </ol>
                </div>
              </div>

              <div style={{ marginTop: 14, background: '#e3f2fd', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#0d47a1' }}>
                <strong>✅ Qué pasa automáticamente:</strong> El CRM recibe la llamada, busca el contacto por número de teléfono, crea un engagement tipo "Llamada" en HubSpot con duración y grabación, lo asocia al contacto y evento, y genera un resumen IA si duró más de 30 segundos.
              </div>
            </div>
          </div>

          {/* Panel de credenciales */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <User size={14} style={{ color: '#ab47bc' }} />
                Credenciales del portal HubSpot
              </h2>
            </div>
            <div className="card-body" style={{ fontSize: 13, lineHeight: 1.8, color: '#546e7a' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#b0bec5', fontSize: 11, textTransform: 'uppercase', marginBottom: 2 }}>Portal ID</div>
                  <code style={{ color: '#4fc3f7' }}>51580878</code>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#b0bec5', fontSize: 11, textTransform: 'uppercase', marginBottom: 2 }}>Token API HubSpot</div>
                  <code style={{ color: '#4fc3f7', fontSize: 11 }}>pat-na1-e745e6a4-de9a-…</code>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#b0bec5', fontSize: 11, textTransform: 'uppercase', marginBottom: 2 }}>Apollo.io API Key</div>
                  <code style={{ color: '#4fc3f7', fontSize: 11 }}>AnL7suGIzVpQTxMuU0ZurA</code>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#b0bec5', fontSize: 11, textTransform: 'uppercase', marginBottom: 2 }}>RocketReach API Key</div>
                  <code style={{ color: '#4fc3f7', fontSize: 11 }}>f7bb52k73266d0f5c44844…</code>
                </div>
                <div style={{ marginTop: 4, background: '#1a2d42', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                  Estas credenciales están almacenadas en el archivo <code>.env</code> del servidor.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
