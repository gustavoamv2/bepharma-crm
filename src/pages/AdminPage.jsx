import React, { useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { Settings, Phone, User, Check, AlertTriangle, Mail, Activity, RefreshCw, Database, Download } from 'lucide-react'
import { admin } from '../hooks/useApi'
import Topbar from '../components/Topbar'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { COUNTRIES } from '../constants/countries'

// Tokens Zadarma por extensión (del archivo Token Hubspot.txt)
const ZADARMA_TOKENS = {
  '100': '545494-100 · c20108dd100b41b51afffd61944bb9cd',  // Carlos
  '101': '545494-101 · 53f4d635b7409046046d7666037528fe',  // Angel
  '102': '545494-102 · 8f58fa2e32f60f00ecbc59d47f84418d',  // Sara
  '103': '545494-103 · 45703acc3d7e78bdc360d347a8b7c74c',  // Gracie
  '104': '545494-104 · UjHqpi8FR9',                         // Yesenia
}

const ROLE_BADGE = {
  supervisor: { label: 'Supervisor', bg: '#e3fcef', color: '#006644' },
  operator:   { label: 'Operador',   bg: '#deebff', color: '#0052cc' },
}

// Descarga un blob en el navegador con el nombre de archivo dado (mismo
// patrón que usan los exports de CompanyList/ContactList/DealList)
function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

function BackupSection() {
  const { addToast } = useToast()
  const [downloading, setDownloading] = useState(null) // 'xlsx' | 'json' | null

  const handleDownload = async (format) => {
    setDownloading(format)
    try {
      const blob = await admin.downloadBackup(format)
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `BePharma_Backup_${date}.${format}`)
    } catch (e) {
      addToast('No se pudo generar la copia de seguridad: ' + (e.response?.data?.error || e.message), 'error')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Database size={15} style={{ color: '#0052cc' }} /> Copia de seguridad
        </h2>
      </div>
      <div className="card-body">
        <p style={{ fontSize: 12, color: '#6b778c', marginBottom: 14 }}>
          Incluye Empresas, Contactos y Eventos (deals) de HubSpot, más la configuración propia
          del CRM que no vive en HubSpot: usuarios, roles, países asignados, extensiones SIP,
          firmas y plantillas de email. No incluye contraseñas.
        </p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => handleDownload('xlsx')} disabled={downloading !== null}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={12} /> {downloading === 'xlsx' ? 'Generando…' : 'Descargar Excel (.xlsx)'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleDownload('json')} disabled={downloading !== null}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={12} /> {downloading === 'json' ? 'Generando…' : 'Descargar JSON'}
          </button>
        </div>
        <div style={{ background: '#e3f2fd', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#0d47a1' }}>
          Además de esta descarga manual, una tarea automática (Vercel Cron) genera esta misma
          copia todos los <strong>lunes a las 08:00 UTC</strong> y la envía por correo a cada
          usuario con rol de supervisor, al correo configurado en «Configuración de Correo por
          Usuario» más abajo.
        </div>
      </div>
    </div>
  )
}

function IntegrationStatus() {
  const [refetchKey, setRefetchKey] = useState(0)
  const { data, isLoading, error } = useQuery(
    ['admin-integrations', refetchKey],
    admin.getIntegrations,
    { staleTime: 60_000 }
  )

  const INTEGRATION_LABELS = {
    hubspot:      'HubSpot API',
    zadarma:      'Zadarma API',
    apollo:       'Apollo.io',
    rocketreach:  'RocketReach',
    anthropic:    'Claude (resumen IA llamadas)',
    email:        'Email SMTP',
    webhookToken: 'Webhook Token',
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={15} style={{ color: '#4fc3f7' }} /> Estado de integraciones
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setRefetchKey(k => k + 1)}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={12} /> Verificar
        </button>
      </div>
      {isLoading ? (
        <div className="loading">Verificando conexiones…</div>
      ) : error ? (
        <div className="card-body"><div className="error-msg">Error al verificar integraciones.</div></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Estado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {data && Object.entries(data).map(([key, info]) => (
                <tr key={key}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{INTEGRATION_LABELS[key] || key}</td>
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                      background: info.ok ? '#e3fcef' : '#ffebe6',
                      color: info.ok ? '#006644' : '#de350b',
                    }}>
                      {info.ok ? <Check size={10} /> : <AlertTriangle size={10} />}
                      {info.ok ? 'OK' : 'Error'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: '#546e7a' }}>
                    {info.label}
                    {info.debug && <div style={{ fontSize: 10, color: '#9e9e9e', marginTop: 2 }}>{info.debug}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function AdminPage() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const qc = useQueryClient()
  const [editingUser, setEditingUser] = useState(null)
  const [sipValue, setSipValue] = useState('')
  const [editingPaises, setEditingPaises] = useState(null)
  const [paisesValue, setPaisesValue] = useState([])
  const [paisesFilter, setPaisesFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeResult, setRecomputeResult] = useState(null)

  const { data: users, isLoading } = useQuery('admin-users', admin.getUsers)

  const isSupervisor = user?.role === 'supervisor'

  const { data: emailStatus } = useQuery('admin-email-status', admin.getEmailStatus, { enabled: isSupervisor })
  const emailStatusByUser = Object.fromEntries((emailStatus || []).map(s => [s.username, s]))

  // Filas visibles: supervisor ve todos, operador solo se ve a sí mismo
  const visibleUsers = isSupervisor
    ? (users || [])
    : (users || []).filter(u => u.username === user?.username)

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

  const savePaises = async (username) => {
    setSaving(true)
    try {
      await admin.updatePaises(username, paisesValue)
      qc.invalidateQueries('admin-users')
      addToast('Países actualizados', 'success')
      setEditingPaises(null)
    } catch (e) {
      addToast('Error al guardar países', 'error')
    } finally {
      setSaving(false)
    }
  }

  const togglePais = (label) => {
    setPaisesValue(prev =>
      prev.includes(label) ? prev.filter(p => p !== label) : [...prev, label]
    )
  }


  const runRecomputeAutoStages = async () => {
    setRecomputing(true)
    setRecomputeResult(null)
    try {
      const r = await admin.recomputeAutoStages()
      setRecomputeResult(r)
      addToast(`Listo: ${r.totalDealsActualizados} deals actualizados de ${r.companiesProcesadas} empresas`, 'success')
    } catch (e) {
      // El error puede venir como string, {error: '...'} o, si algo se cae antes
      // de llegar al handler (404/500 de Vercel), como HTML — nunca concatenar
      // el objeto crudo, o se ve literalmente "[object Object]" en el toast.
      const raw = e.response?.data?.error ?? e.response?.data
      const msg = typeof raw === 'string' && raw
        ? raw
        : (raw && typeof raw === 'object' ? JSON.stringify(raw) : null) || e.message || 'Error desconocido'
      addToast('Error al recalcular etapas: ' + msg, 'error')
    } finally {
      setRecomputing(false)
    }
  }

  return (
    <>
      <Topbar title="Administracion" />
      <div className="content">

        {/* Copia de seguridad — solo supervisores */}
        {isSupervisor && <BackupSection />}

        {/* Estado de integraciones — solo supervisores */}
        {isSupervisor && <IntegrationStatus />}

        {/* Recalcular etapas automáticas — solo supervisores */}
        {isSupervisor && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <RefreshCw size={15} style={{ color: '#66bb6a' }} /> Etapas automáticas (Nueva / En Depuración / En Enriquecimiento / Por Contactar)
              </h2>
            </div>
            <div className="card-body">
              <p style={{ fontSize: 12, color: '#6b778c', marginBottom: 12 }}>
                Estas 4 etapas las asigna el CRM automáticamente según cuántos datos de contacto
                (teléfono/email de la empresa o de sus contactos) tiene cada evento. El recálculo
                ya corre solo cada vez que se edita un contacto o una empresa desde el CRM — este
                botón sirve para forzar una pasada completa (por ejemplo, la primera vez, o si algo
                se editó directo en HubSpot sin pasar por el CRM). Nunca toca deals en En Seguimiento,
                Confirmada o No Participa — esas son siempre decisión del operador.
              </p>
              <button className="btn btn-primary btn-sm" onClick={runRecomputeAutoStages} disabled={recomputing}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={12} /> {recomputing ? 'Recalculando…' : 'Recalcular etapas ahora'}
              </button>
              {recomputeResult && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#374151' }}>
                  {recomputeResult.dealsEvaluados} deals evaluados · {recomputeResult.companiesProcesadas} empresas procesadas ·{' '}
                  <strong>{recomputeResult.totalDealsActualizados} deals actualizados</strong>
                </div>
              )}
            </div>
          </div>
        )}

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
                  {visibleUsers.map(u => {
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

        {/* Países asignados por operador */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              🌎 Países asignados por Operador
            </h2>
          </div>
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <p style={{ fontSize: 12, color: '#6b778c', marginTop: -4, marginBottom: 12 }}>
              Cada operador puede tener uno o varios países asignados (sin importar de qué zona sean).
              Un mismo país puede asignarse a más de un operador. Esto controla qué deals, contactos y
              empresas ve el operador, además del propietario (owner) asignado en HubSpot.
            </p>
          </div>
          {isLoading ? (
            <div className="loading">Cargando…</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Países asignados</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map(u => {
                    const isEditing = editingPaises === u.username
                    return (
                      <tr key={u.username}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: '#6b778c' }}>@{u.username}</div>
                        </td>
                        <td>
                          <span style={{ background: ROLE_BADGE[u.role]?.bg, color: ROLE_BADGE[u.role]?.color, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                            {ROLE_BADGE[u.role]?.label}
                          </span>
                        </td>
                        <td style={{ maxWidth: 420 }}>
                          {isEditing ? (
                            <div style={{ border: '1px solid #4fc3f7', borderRadius: 6, padding: 8, width: 320 }}>
                              <input
                                value={paisesFilter}
                                onChange={e => setPaisesFilter(e.target.value)}
                                placeholder="Buscar país…"
                                style={{ width: '100%', padding: '4px 8px', border: '1px solid #dfe1e6', borderRadius: 4, fontSize: 12, marginBottom: 6 }}
                                autoFocus
                              />
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6, minHeight: 20 }}>
                                {paisesValue.length === 0 ? (
                                  <span style={{ fontSize: 11, color: '#9e9e9e' }}>Sin países seleccionados</span>
                                ) : paisesValue.map(p => (
                                  <span key={p} style={{ background: '#e3f2fd', color: '#0052cc', borderRadius: 10, padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    {p}
                                    <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => togglePais(p)}>×</span>
                                  </span>
                                ))}
                              </div>
                              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #eef2f6', borderRadius: 4 }}>
                                {COUNTRIES
                                  .filter(c => c.label.toLowerCase().includes(paisesFilter.toLowerCase()))
                                  .map(c => (
                                    <label key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
                                      <input
                                        type="checkbox"
                                        checked={paisesValue.includes(c.label)}
                                        onChange={() => togglePais(c.label)}
                                      />
                                      {c.label}
                                    </label>
                                  ))}
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {(u.bp_paises || []).length === 0 ? (
                                <span style={{ fontWeight: 600, color: '#6b778c' }}>—</span>
                              ) : (u.bp_paises || []).map(p => (
                                <span key={p} style={{ background: '#e3f2fd', color: '#0052cc', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                                  {p}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-primary btn-sm" onClick={() => savePaises(u.username)} disabled={saving}>
                                <Check size={12} /> {saving ? '…' : 'Guardar'}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditingPaises(null)}>×</button>
                            </div>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => { setEditingPaises(u.username); setPaisesValue(u.bp_paises || []); setPaisesFilter('') }}>
                              Editar países
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
            <span style={{ fontSize: 11, color: '#6b778c' }}>Define de qué buzón sale cada correo enviado desde el CRM</span>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleUsers.map(u => {
                const st = emailStatusByUser[u.username]
                return (
                  <div key={u.username} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: '#6b778c' }}>@{u.username}</div>
                    </div>
                    {st && (
                      <div style={{
                        fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 10,
                        background: st.configured ? '#e3fcef' : '#fff3cd',
                        color: st.configured ? '#006644' : '#8a6914',
                      }}>
                        {st.configured ? <Check size={11} /> : <AlertTriangle size={11} />}
                        {st.configured ? st.emailUser : 'Sin EMAIL_USER_* — envía por el remitente por defecto'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Instrucciones de integración Zadarma — solo supervisores */}
        {isSupervisor && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

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
                <strong>Tip:</strong> Asegurate de que tu extension este configurada en la tabla de arriba y el softphone este conectado antes de intentar llamadas.
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
                  <code style={{ color: '#4fc3f7', fontSize: 11 }}>pat-na1-••••••••••••••••••••••••••</code>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#b0bec5', fontSize: 11, textTransform: 'uppercase', marginBottom: 2 }}>Apollo.io API Key</div>
                  <code style={{ color: '#4fc3f7', fontSize: 11 }}>••••••••••••••••••••••</code>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#b0bec5', fontSize: 11, textTransform: 'uppercase', marginBottom: 2 }}>RocketReach API Key</div>
                  <code style={{ color: '#4fc3f7', fontSize: 11 }}>••••••••••••••••••••••</code>
                </div>
                <div style={{ marginTop: 4, background: '#1a2d42', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                  Estas credenciales estan almacenadas en el archivo <code>.env</code> del servidor. El estado de conexion se verifica en el panel superior.
                </div>
              </div>
            </div>
          </div>
        </div>}
      </div>
    </>
  )
}
