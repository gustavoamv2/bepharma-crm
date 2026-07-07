require('dotenv').config()
const env = require('./config/env')   // valida vars criticas; falla si faltan

const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const axios = require('axios')
const crypto = require('crypto')
const nodemailer = require('nodemailer')
const fs = require('fs')
const path = require('path')
const FormData = require('form-data')
const { login, requireAuth, applyOwnerFilter, applyCountryFilter, addFilterToGroups, generateResetToken, resetPasswordWithToken, changePassword } = require('./auth')
const { requireWebhookToken } = require('./middleware/webhookAuth')
const { errorHandler } = require('./middleware/errorHandler')
const { loadUsers, saveUsers } = require('./usersStore')
const { getSignature, saveSignature, kvEnabled } = require('./signatureStore')
const { getTemplates: getEmailTemplates, saveTemplates: saveEmailTemplates, kvEnabled: templatesKvEnabled } = require('./emailTemplatesStore')
const { upsertMessage: upsertMailboxMessage, listMessages: listMailboxMessages, getThread: getMailboxThread, patchMessage: patchMailboxMessage, patchThread: patchMailboxThread, deleteMessage: deleteMailboxMessage, deleteThread: deleteMailboxThread, normalizeSubject: normalizeMailboxSubject } = require('./emailMailboxStore')
const { buildReportWorkbook, buildMultiSectionWorkbook, workbookToBuffer } = require('./services/excelExport.service')
const { buildFullBackupData, buildFullBackupWorkbook } = require('./services/backup.service')

const app = express()

// ── Seguridad base ────────────────────────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: env.APP_ORIGIN,
  credentials: true,
}))
// 4mb: deja margen bajo el límite de ~4.5mb de Vercel para el body de la función
// serverless (necesario para adjuntos de email codificados en base64)
// "verify" guarda el body crudo (rawBody) sin tocar el resto de las rutas —
// lo necesita el webhook de Resend Inbound para validar la firma Svix, que es
// sensible a cualquier diferencia de bytes entre el JSON parseado y el original.
app.use(express.json({
  limit: '4mb',
  verify: (req, _res, buf) => { req.rawBody = buf }
}))

// Request ID minimo para trazabilidad en logs
app.use((req, _res, next) => {
  req.id = crypto.randomBytes(6).toString('hex')
  next()
})

// Rate limit en login: max 10 intentos por IP por 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { data: null, meta: {}, error: { code: 'RATE_LIMIT', message: 'Demasiados intentos. Intenta en 15 minutos.' } }
})

// Rate limit en "olvidé mi contraseña": max 5 solicitudes por IP por 15 minutos
// (evita spam de emails y dificulta enumerar usuarios validos por fuerza bruta)
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { data: null, meta: {}, error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Intenta en 15 minutos.' } }
})

const PORT = env.PORT

// ──────────────────────────────────────────────────────────────────────────────
// HEALTH — check basico, sin auth, para monitoreo/uptime
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: require('../package.json').version,
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' })
    const result = await login(username, password)
    res.json(result)
  } catch (e) {
    res.status(401).json({ error: 'Credenciales invalidas' })
  }
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

// "Olvidé mi contraseña" — manda un link de un solo uso (30 min) al correo
// configurado del usuario (EMAIL_USER_<USERNAME> en .env), usando su propio
// transporte SMTP (getUserMailer/getUserEmail, definidos mas abajo en este
// archivo pero disponibles aqui por hoisting de function declarations).
// Respuesta SIEMPRE generica: no revela si el usuario existe o si tiene
// correo configurado, para no facilitar enumeracion de usuarios validos.
app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const generic = {
    success: true,
    message: 'Si el usuario existe y tiene un correo configurado, se envió un link para restablecer la contraseña.',
  }
  const { username } = req.body
  if (!username) return res.status(400).json({ error: 'Falta el usuario' })

  try {
    const { token, user } = generateResetToken(username)
    const to = getUserEmail(username)
    const mailer = getUserMailer(username)
    if (!to || !mailer) {
      console.warn(`[forgot-password] usuario "${username}" sin correo configurado (EMAIL_USER_${username.toUpperCase()})`)
      return res.json(generic)
    }

    const resetLink = `${env.APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`
    const html = `
      <p>Hola ${user.name || username},</p>
      <p>Recibimos una solicitud para restablecer tu contraseña del CRM de BePharma.</p>
      <p><a href="${resetLink}">Haz clic aquí para elegir una nueva contraseña</a></p>
      <p>Este link expira en 30 minutos. Si tú no solicitaste esto, puedes ignorar este correo.</p>
    `
    await mailer.sendMail({ from: to, to, subject: 'BePharma CRM — Restablecer contraseña', html })
    res.json(generic)
  } catch (e) {
    console.warn('[forgot-password]', e.message)
    res.json(generic) // nunca revelar el motivo real (usuario inexistente, etc.)
  }
})

// Aplica la nueva contraseña usando el token del link de "olvidé mi contraseña"
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body
    if (!token || !newPassword) return res.status(400).json({ error: 'Faltan datos' })
    const result = await resetPasswordWithToken(token, newPassword)
    res.json({ success: true, username: result.username })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// Cambio de contraseña por el propio usuario ya logueado (requiere la actual)
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan datos' })
    await changePassword(req.user.username, currentPassword, newPassword)
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// HUBSPOT
// ──────────────────────────────────────────────────────────────────────────────
const { hs, countDeals } = require('./repositories/hubspot.repository')
const {
  DEAL_PROPERTIES,
  DEAL_DETAIL_PROPERTIES,
  COMPANY_PROPERTIES,
  CONTACT_PROPERTIES,
  PIPELINE_STAGES,
  ACTIVE_EVENT,
  AUTO_STAGE_KEYS,
  COMPANY_QUALITY_FILTERS,
  CONTACT_QUALITY_FILTERS,
  activeEventFilter,
  notTerminalFilters,
} = require('./config/hubspotProperties')
const {
  recomputeDealStagesForCompany,
  getCompanyIdsForContact,
} = require('./services/autoStage.service')

async function searchDealsWithCompanyParticipation({ filterGroups, sorts, limit = 50, after, properties, companyParticipatedBefore }) {
  const mode = companyParticipatedBefore === 'yes' || companyParticipatedBefore === 'no' ? companyParticipatedBefore : ''
  if (!mode) {
    if (Number(limit || 50) <= 100) {
      const r = await hs.post('/crm/v3/objects/deals/search', {
        filterGroups,
        sorts,
        limit,
        after,
        properties: properties || DEAL_PROPERTIES,
      })
      return r.data
    }
    const allDeals = []
    let cursor
    const max = Number(limit || 4000)
    for (let page = 0; page < 40 && allDeals.length < max; page++) {
      const r = await hs.post('/crm/v3/objects/deals/search', {
        filterGroups,
        sorts,
        limit: Math.min(100, max - allDeals.length),
        after: cursor,
        properties: properties || DEAL_PROPERTIES,
      })
      allDeals.push(...(r.data.results || []))
      cursor = r.data.paging?.next?.after
      if (!cursor) break
    }
    return { total: allDeals.length, results: allDeals }
  }

  const allDeals = []
  let cursor
  for (let page = 0; page < 40; page++) {
    const r = await hs.post('/crm/v3/objects/deals/search', {
      filterGroups,
      sorts,
      limit: 100,
      after: cursor,
      properties: properties || DEAL_PROPERTIES,
    })
    allDeals.push(...(r.data.results || []))
    cursor = r.data.paging?.next?.after
    if (!cursor) break
  }

  const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size))
  const dealCompanyIds = new Map()
  const dealIds = allDeals.map(d => String(d.id))

  for (const ids of chunk(dealIds, 100)) {
    const ar = await hs.post('/crm/v4/associations/deals/companies/batch/read', {
      inputs: ids.map(id => ({ id }))
    })
    for (const row of (ar.data.results || [])) {
      const fromId = String(row.from?.id || row.fromId || '')
      const toIds = (row.to || row.results || [])
        .map(t => String(t.toObjectId || t.id || t.to?.id || ''))
        .filter(Boolean)
      if (fromId) dealCompanyIds.set(fromId, toIds)
    }
  }

  const companyIds = [...new Set([...dealCompanyIds.values()].flat())]
  const participatedCompanies = new Set()
  for (const ids of chunk(companyIds, 100)) {
    const cr = await hs.post('/crm/v3/objects/companies/batch/read', {
      inputs: ids.map(id => ({ id })),
      properties: ['bp_participo_eventos'],
    })
    for (const company of (cr.data.results || [])) {
      const value = company.properties?.bp_participo_eventos
      if (value === true || value === 'true') participatedCompanies.add(String(company.id))
    }
  }

  const filtered = allDeals.filter(deal => {
    const ids = dealCompanyIds.get(String(deal.id)) || []
    const hasParticipated = ids.some(id => participatedCompanies.has(String(id)))
    return mode === 'yes' ? hasParticipated : !hasParticipated
  })
  const offset = Number(after || 0) || 0
  const page = filtered.slice(offset, offset + Number(limit || 50))
  const nextOffset = offset + Number(limit || 50)
  return {
    total: filtered.length,
    results: page,
    ...(nextOffset < filtered.length ? { paging: { next: { after: String(nextOffset) } } } : {}),
  }
}

// Deals – búsqueda con filtros BePharma
app.post('/api/hubspot/deals/search', requireAuth, async (req, res) => {
  try {
    const { filters = [], sorts = [], limit = 50, after, properties, companyParticipatedBefore } = req.body
    let filterGroups = applyOwnerFilter(req, filters.length ? [{ filters }] : [])
    filterGroups = applyCountryFilter(req, filterGroups, 'bp_evento_paises')
    const data = await searchDealsWithCompanyParticipation({
      filterGroups,
      sorts,
      limit,
      after,
      properties,
      companyParticipatedBefore,
    })
    res.json(data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Etiquetas para el reporte Excel — mismas claves que bp_estado_prospeccion
const DEAL_ESTADO_LABELS_XLS = {
  nueva: 'Nueva', en_depuracion: 'En Depuración', en_enriquecimiento: 'En Enriquecimiento',
  contacto_enviado: 'Por Contactar', en_seguimiento: 'En Seguimiento',
  confirmada: 'Confirmada', no_participa: 'No Participa',
}
const DEAL_OWNER_NAMES_XLS = {
  '93615311': 'Roberto', '93621022': 'Yesenia', '93771980': 'Angel',
  '93771979': 'Gracie', '93771981': 'Carlos', '73112880': 'Sara',
}
const DEAL_EXPORT_COLUMNS = [
  { header: 'Evento',              key: 'evento',       width: 34 },
  { header: 'Owner',                key: 'owner',        width: 16 },
  { header: 'Zona',                 key: 'zona',         width: 16 },
  { header: 'País',                 key: 'pais',         width: 18 },
  { header: 'Estado',               key: 'estado',       width: 18 },
  { header: 'Próximo contacto',     key: 'proximo',      width: 16 },
  { header: 'Última actividad',     key: 'ultimaActividad', width: 16 },
  { header: 'Alerta',               key: 'alerta',       width: 14 },
  { header: 'Creado',               key: 'creado',       width: 14 },
]

// Reporte Excel del listado de Eventos (DealList) — respeta los mismos
// filtros que /deals/search (evento activo, estado, alerta, owner, país,
// búsqueda) pero pagina TODOS los resultados y arma el .xlsx con logo
// BePharma + evento activo + resumen de filtros.
app.post('/api/hubspot/deals/export', requireAuth, async (req, res) => {
  try {
    const { filters = [], filtroResumen, companyParticipatedBefore } = req.body
    let filterGroups = applyOwnerFilter(req, filters.length ? [{ filters }] : [])
    filterGroups = applyCountryFilter(req, filterGroups, 'bp_evento_paises')

    const allDealsData = await searchDealsWithCompanyParticipation({
      filterGroups,
      sorts: [{ propertyName: 'bp_ultima_actividad_operador', direction: 'DESCENDING' }],
      limit: 4000,
      properties: DEAL_PROPERTIES,
      companyParticipatedBefore,
    })
    const allDeals = allDealsData.results || []

    const fmtDate = (v) => {
      if (!v) return ''
      const n = Number(v)
      const d = isNaN(n) || n < 1e10 ? new Date(v) : new Date(n)
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX')
    }

    const rows = allDeals.map(d => {
      const p = d.properties || {}
      return {
        evento: p.dealname || '(sin nombre)',
        owner: DEAL_OWNER_NAMES_XLS[p.hubspot_owner_id] || '',
        zona: p.bp_zona || '',
        pais: p.bp_evento_paises || '',
        estado: DEAL_ESTADO_LABELS_XLS[p.bp_estado_prospeccion] || p.bp_estado_prospeccion || '',
        proximo: fmtDate(p.bp_proximo_contacto),
        ultimaActividad: fmtDate(p.bp_ultima_actividad_operador),
        alerta: p.bp_estado_alerta === 'alerta_roja' ? 'Roja' : p.bp_estado_alerta === 'alerta_amarilla' ? 'Amarilla' : '',
        creado: fmtDate(p.createdate),
      }
    })

    const workbook = await buildReportWorkbook({
      sheetName: 'Eventos',
      title: 'BePharma CRM — Reporte de Eventos',
      eventoActivo: ACTIVE_EVENT,
      filtroResumen,
      generadoPor: req.user?.username,
      columns: DEAL_EXPORT_COLUMNS,
      rows,
    })
    const buffer = await workbookToBuffer(workbook)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="BePharma_Eventos_${ACTIVE_EVENT}_${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (e) {
    console.error('[deals/export] Error:', e.response?.data || e.message)
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Deal – detalle
app.get('/api/hubspot/deals/:id', requireAuth, async (req, res) => {
  try {
    const r = await hs.get(`/crm/v3/objects/deals/${req.params.id}`, {
      params: {
        properties: DEAL_DETAIL_PROPERTIES.join(','),
        associations: 'contacts,companies,notes,calls,tasks',
      },
    })
    const deal = r.data

    // Deduplicar empresas y enriquecer con nombre
    const rawCompanies = deal.associations?.companies?.results || []
    const uniqueCompanyIds = [...new Set(rawCompanies.map(c => String(c.id)))]
    if (uniqueCompanyIds.length > 0) {
      try {
        const cr = await hs.post('/crm/v3/objects/companies/batch/read', {
          inputs: uniqueCompanyIds.map(id => ({ id })),
          properties: [
            'name', 'domain', 'bp_participo_eventos',
            // Teléfonos de la empresa (1/2/3)
            'phone', 'bp_telefonos_adicionales', 'bp_telefono_3',
            // Emails de la empresa (1/2/3)
            'bp_email_empresa', 'bp_email_2', 'bp_email_3',
            // Datos del contacto principal registrados en la ficha de Empresa
            'bp_contacto_principal_texto', 'bp_cargo_contacto_principal',
            'bp_email_contacto_principal', 'bp_telefono_contacto_principal',
          ],
        })
        const byId = Object.fromEntries((cr.data.results || []).map(c => [c.id, c]))
        deal.associations.companies.results = uniqueCompanyIds.map(id => byId[id]).filter(Boolean)
      } catch {
        deal.associations.companies.results = uniqueCompanyIds.map(id => ({ id }))
      }
    }

    // Deduplicar contactos y enriquecer con nombre, teléfono y email
    // Fallback: si el deal no tiene contactos directos, tomar los de la empresa vinculada
    let rawContacts = deal.associations?.contacts?.results || []
    if (rawContacts.length === 0 && uniqueCompanyIds.length > 0) {
      try {
        // Pedir asociaciones de contactos para cada empresa vinculada
        const assocResults = await Promise.all(
          uniqueCompanyIds.map(cid =>
            hs.get(`/crm/v3/objects/companies/${cid}/associations/contacts`)
              .then(r => r.data.results || [])
              .catch(() => [])
          )
        )
        rawContacts = assocResults.flat()
        // Inicializar la clave si no existía
        if (!deal.associations) deal.associations = {}
        if (!deal.associations.contacts) deal.associations.contacts = { results: [] }
      } catch { /* no crítico */ }
    }

    const uniqueContactIds = [...new Set(rawContacts.map(c => String(c.id || c.toObjectId)))]
    if (uniqueContactIds.length > 0) {
      try {
        const cr = await hs.post('/crm/v3/objects/contacts/batch/read', {
          inputs: uniqueContactIds.map(id => ({ id })),
          properties: [
            'firstname', 'lastname', 'jobtitle',
            // Teléfonos del contacto (1/2/3)
            'phone', 'mobilephone', 'bp_telefono_3',
            // Emails del contacto (1/2/3)
            'email', 'bp_email_2', 'bp_email_3',
          ],
        })
        const byId = Object.fromEntries((cr.data.results || []).map(c => [c.id, c]))
        deal.associations.contacts.results = uniqueContactIds.map(id => byId[id]).filter(Boolean)
      } catch {
        deal.associations.contacts.results = uniqueContactIds.map(id => ({ id }))
      }
    }

    res.json(deal)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Empresas – búsqueda (sin filtro de owner: las empresas son registros compartidos;
// sí se restringen por país cuando el operador tiene países asignados en su config)
// contactsFilter: 'with' → solo empresas con contactos asociados (num_associated_contacts > 0)
//                 'without' → solo empresas sin contactos (propiedad ausente o en 0)
function withContactsFilter(filterGroups, contactsFilter) {
  if (contactsFilter === 'with') {
    return addFilterToGroups(filterGroups, { propertyName: 'num_associated_contacts', operator: 'GT', value: '0' })
  }
  if (contactsFilter === 'without') {
    const base = filterGroups.length ? filterGroups : [{ filters: [] }]
    return base.flatMap(group => ([
      { ...group, filters: [...(group.filters || []), { propertyName: 'num_associated_contacts', operator: 'NOT_HAS_PROPERTY' }] },
      { ...group, filters: [...(group.filters || []), { propertyName: 'num_associated_contacts', operator: 'EQ', value: '0' }] },
    ]))
  }
  return filterGroups
}

// qualityFilter: una clave de COMPANY_QUALITY_FILTERS o CONTACT_QUALITY_FILTERS
// (según el objeto) — usado tanto por el listado (al hacer clic en una barra
// del gráfico de calidad de datos) como por el endpoint de /quality-metrics
// correspondiente (los conteos de esas barras), para que ambos usen siempre
// el mismo criterio de filtro.
function withQualityFilter(filterGroups, qualityFilter, defs = COMPANY_QUALITY_FILTERS) {
  const def = defs[qualityFilter]
  if (!def) return filterGroups
  if (def.orFilters.length === 1) {
    return addFilterToGroups(filterGroups, def.orFilters[0])
  }
  const base = filterGroups.length ? filterGroups : [{ filters: [] }]
  return base.flatMap(group => def.orFilters.map(f => ({ filters: [...(group.filters || []), f] })))
}

// Version multi-select de withQualityFilter — usada por los checkboxes del
// listado (CompanyList/ContactList), que permiten combinar varios criterios
// de calidad a la vez (ej. "Sin contacto" + "Sin teléfono"). Semántica: el
// registro debe cumplir el filtro existente Y (any de los criterios
// seleccionados) — mismo patrón OR-entre-grupos que la versión singular,
// solo que unifica los orFilters de todas las keys elegidas.
function withQualityFilters(filterGroups, keys, defs = COMPANY_QUALITY_FILTERS) {
  const list = Array.isArray(keys) ? keys.filter(k => defs[k]) : []
  if (!list.length) return filterGroups
  const allOrFilters = list.flatMap(k => defs[k].orFilters)
  const base = filterGroups.length ? filterGroups : [{ filters: [] }]
  return base.flatMap(group => allOrFilters.map(f => ({ filters: [...(group.filters || []), f] })))
}

// Normaliza qualityFilters recibido por query o body — acepta array (JSON
// body) o CSV (query string, ej. ?qualityFilters=sinContacto,sinTelefono).
function parseQualityFilters(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

app.post('/api/hubspot/companies/search', requireAuth, async (req, res) => {
  try {
    const { filters = [], sorts = [], limit = 50, after, properties: customProps, contactsFilter, qualityFilter, qualityFilters } = req.body
    let filterGroups = filters.length ? [{ filters }] : []
    filterGroups = withContactsFilter(filterGroups, contactsFilter)
    const qfList = parseQualityFilters(qualityFilters)
    filterGroups = qfList.length
      ? withQualityFilters(filterGroups, qfList)
      : withQualityFilter(filterGroups, qualityFilter)
    filterGroups = applyCountryFilter(req, filterGroups, 'country', { translate: true })
    const r = await hs.post('/crm/v3/objects/companies/search', {
      filterGroups,
      sorts,
      limit,
      after,
      properties: customProps || COMPANY_PROPERTIES,
    })
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Empresas – gráfico de calidad de datos (sin contacto/teléfono/página web/
// correo/eventos). Mismo criterio de filtro que qualityFilter en /search
// (ver COMPANY_QUALITY_FILTERS) para que el conteo de la barra y el listado
// que se abre al hacer clic coincidan siempre.
app.get('/api/hubspot/companies/quality-metrics', requireAuth, async (req, res) => {
  // Filtros opcionales del listado de Empresas (CompanyList) para que el
  // gráfico "Calidad de datos" refleje lo que el usuario está viendo
  // (búsqueda por nombre, país seleccionado, con/sin contactos) y no siempre
  // el total sin filtrar. No se incluye qualityFilter: el gráfico debe seguir
  // mostrando la distribución completa aunque haya una barra ya seleccionada.
  const { search, country, contactsFilter } = req.query
  const baseFilters = []
  if (search)  baseFilters.push({ propertyName: 'name',    operator: 'CONTAINS_TOKEN', value: search })
  if (country) baseFilters.push({ propertyName: 'country', operator: 'EQ',             value: country })

  const countFor = async (key) => {
    try {
      let filterGroups = baseFilters.length ? [{ filters: baseFilters }] : []
      filterGroups = withContactsFilter(filterGroups, contactsFilter)
      filterGroups = withQualityFilter(filterGroups, key)
      filterGroups = applyCountryFilter(req, filterGroups, 'country', { translate: true })
      const r = await hs.post('/crm/v3/objects/companies/search', {
        filterGroups, limit: 1, properties: ['name'],
      })
      return r.data.total || 0
    } catch { return 0 }
  }
  const delay = (ms) => new Promise(r => setTimeout(r, ms))

  const metrics = {}
  for (const key of Object.keys(COMPANY_QUALITY_FILTERS)) {
    metrics[key] = await countFor(key)
    await delay(260)
  }
  res.json(metrics)
})

// Etiquetas para el reporte Excel — mismas claves que bp_etapa_empresa
const COMPANY_STAGE_LABELS_XLS = {
  nueva: 'Nueva', depuracion: 'Depuración', enriquecimiento: 'Enriquecimiento',
  calificada: 'Calificada', contactada: 'Contactada', seguimiento: 'Seguimiento',
  confirmada: 'Confirmada', descartada: 'Descartada',
}

const COMPANY_EXPORT_COLUMNS = [
  { header: 'Empresa',              key: 'name',             width: 32 },
  { header: 'Dominio',               key: 'domain',           width: 24 },
  { header: 'Teléfono',              key: 'phone',            width: 18 },
  { header: 'País',                  key: 'country',          width: 18 },
  { header: 'Ciudad',                key: 'city',             width: 18 },
  { header: 'Industria',             key: 'industry',         width: 22 },
  { header: 'Etapa',                 key: 'etapa',            width: 16 },
  { header: 'Contactos asociados',   key: 'contactos',        width: 16 },
  { header: 'Eventos asociados',     key: 'eventos',          width: 15 },
  { header: 'Participó en eventos',  key: 'participoEventos', width: 16 },
  { header: 'Lista negra',           key: 'listaNegra',        width: 12 },
  { header: 'Creada',                key: 'creada',           width: 14 },
]

// Reporte Excel del listado de Empresas — respeta los mismos filtros que
// /companies/search (búsqueda, país, con/sin contactos, calidad de datos
// multi-select) pero pagina TODOS los resultados (hasta un tope razonable)
// en vez de una sola página, y arma un .xlsx con logo BePharma + evento
// activo + resumen de filtros (recibido del cliente, que ya conoce las
// etiquetas legibles de cada filtro).
app.post('/api/hubspot/companies/export', requireAuth, async (req, res) => {
  try {
    const { filters = [], contactsFilter, qualityFilter, qualityFilters, filtroResumen } = req.body
    let filterGroups = filters.length ? [{ filters }] : []
    filterGroups = withContactsFilter(filterGroups, contactsFilter)
    const qfList = parseQualityFilters(qualityFilters)
    filterGroups = qfList.length
      ? withQualityFilters(filterGroups, qfList)
      : withQualityFilter(filterGroups, qualityFilter)
    filterGroups = applyCountryFilter(req, filterGroups, 'country', { translate: true })

    const MAX_PAGES = 40 // hasta 4000 empresas (100 x 40)
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    const allCompanies = []
    let after
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await sleep(260)
      const r = await hs.post('/crm/v3/objects/companies/search', {
        filterGroups,
        sorts: [{ propertyName: 'name', direction: 'ASCENDING' }],
        limit: 100,
        after,
        properties: COMPANY_PROPERTIES,
      })
      allCompanies.push(...(r.data.results || []))
      after = r.data.paging?.next?.after
      if (!after) break
    }

    const rows = allCompanies.map(c => {
      const p = c.properties || {}
      return {
        name: p.name || '(sin nombre)',
        domain: p.domain || '',
        phone: p.phone || '',
        country: p.country || '',
        city: p.city || '',
        industry: p.industry || '',
        etapa: COMPANY_STAGE_LABELS_XLS[p.bp_etapa_empresa] || p.bp_etapa_empresa || '',
        contactos: Number(p.num_associated_contacts) || 0,
        eventos: Number(p.num_associated_deals) || 0,
        participoEventos: (p.bp_participo_eventos === 'true' || p.bp_participo_eventos === true) ? 'Sí' : 'No',
        listaNegra: (p.bp_lista_negra === 'true' || p.bp_lista_negra === true) ? 'Sí' : 'No',
        creada: p.createdate ? new Date(Number(p.createdate) || p.createdate).toLocaleDateString('es-MX') : '',
      }
    })

    const workbook = await buildReportWorkbook({
      sheetName: 'Empresas',
      title: 'BePharma CRM — Reporte de Empresas',
      eventoActivo: ACTIVE_EVENT,
      filtroResumen,
      generadoPor: req.user?.username,
      columns: COMPANY_EXPORT_COLUMNS,
      rows,
    })
    const buffer = await workbookToBuffer(workbook)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="BePharma_Empresas_${ACTIVE_EVENT}_${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (e) {
    console.error('[companies/export] Error:', e.response?.data || e.message)
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Búsqueda rápida de empresas por nombre (DEBE ir antes de /:id)
app.get('/api/hubspot/companies/quick-search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim()
    const body = {
      properties: ['name', 'domain', 'city'],
      sorts: [{ propertyName: 'name', direction: 'ASCENDING' }],
      limit: 50
    }
    if (q) {
      body.filterGroups = [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: q }] }]
    }
    const r = await hs.post('/crm/v3/objects/companies/search', body)
    res.json({ results: r.data.results || [] })
  } catch (e) {
    res.json({ results: [] })
  }
})

// Métricas de empresas por etapa (DEBE ir antes de /:id)
app.get('/api/hubspot/companies/pipeline-metrics', requireAuth, async (req, res) => {
  try {
    const STAGES = ['nueva', 'depuracion', 'enriquecimiento', 'calificada', 'contactada', 'seguimiento', 'confirmada', 'descartada']
    const counts = await Promise.all(STAGES.map(stage =>
      hs.post('/crm/v3/objects/companies/search', {
        filterGroups: [{ filters: [{ propertyName: 'bp_etapa_empresa', operator: 'EQ', value: stage }] }],
        limit: 1, properties: ['name']
      }).then(r => r.data.total || 0).catch(() => 0)
    ))
    const byStage = Object.fromEntries(STAGES.map((s, i) => [s, counts[i]]))
    const total = counts.reduce((a, b) => a + b, 0)
    res.json({ byStage, total })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Empresa – detalle (con nombres de contactos y deals)
app.get('/api/hubspot/companies/:id', requireAuth, async (req, res) => {
  try {
    const r = await hs.get(`/crm/v3/objects/companies/${req.params.id}`, {
      params: {
        properties: COMPANY_PROPERTIES.join(','),
        associations: 'contacts,deals,notes',
      },
    })
    const company = r.data

    // Enriquecer contactos con nombre y email
    const contactIds = [...new Set((company.associations?.contacts?.results || []).map(c => c.id))]
    const dealIds    = [...new Set((company.associations?.deals?.results || []).map(d => d.id))]

    const [contacts, deals] = await Promise.all([
      contactIds.length
        ? Promise.all(contactIds.slice(0, 10).map(cid =>
            hs.get(`/crm/v3/objects/contacts/${cid}`, {
              params: { properties: 'firstname,lastname,email,jobtitle' }
            }).then(r => r.data).catch(() => ({ id: cid, properties: {} }))
          ))
        : [],
      dealIds.length
        ? Promise.all(dealIds.slice(0, 25).map(did =>
            hs.get(`/crm/v3/objects/deals/${did}`, {
              params: { properties: 'dealname,dealstage,amount,bp_estado_prospeccion,bp_evento_codigo' }
            }).then(r => r.data).catch(() => ({ id: did, properties: {} }))
          ))
        : []
    ])

    // Reemplazar la lista de asociaciones con los objetos enriquecidos
    if (company.associations?.contacts) {
      company.associations.contacts.results = contacts
    }
    if (company.associations?.deals) {
      company.associations.deals.results = deals
    }

    res.json(company)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Contactos – búsqueda
app.post('/api/hubspot/contacts/search', requireAuth, async (req, res) => {
  try {
    const { filters = [], filterGroups: fgBody, sorts = [], limit = 50, after, qualityFilter, qualityFilters } = req.body
    // fgBody permite OR entre propiedades (nombre, apellido, teléfono, país, empresa)
    const baseGroups = fgBody || (filters.length ? [{ filters }] : [])
    let filterGroups = applyOwnerFilter(req, baseGroups)
    const qfList = parseQualityFilters(qualityFilters)
    filterGroups = qfList.length
      ? withQualityFilters(filterGroups, qfList, CONTACT_QUALITY_FILTERS)
      : withQualityFilter(filterGroups, qualityFilter, CONTACT_QUALITY_FILTERS)
    filterGroups = applyCountryFilter(req, filterGroups, 'country', { translate: true })
    const r = await hs.post('/crm/v3/objects/contacts/search', {
      filterGroups,
      sorts,
      limit,
      after,
      properties: CONTACT_PROPERTIES,
    })
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Contactos – gráfico de calidad de datos (sin correo/teléfono/cargo/empresa/
// LinkedIn). Mismo criterio de filtro que qualityFilter en /search (ver
// CONTACT_QUALITY_FILTERS) para que el conteo de la barra y el listado que se
// abre al hacer clic coincidan siempre. Respeta el scoping de owner/país de
// la vista de operador, igual que /contacts/search.
app.get('/api/hubspot/contacts/quality-metrics', requireAuth, async (req, res) => {
  // Filtros opcionales de búsqueda y país del listado de Contactos
  // (ContactList), para que el gráfico refleje lo que el usuario está viendo
  // (antes solo se recibía `search`, así que elegir un país no cambiaba el
  // gráfico). No se incluye qualityFilter: el gráfico debe seguir mostrando
  // la distribución completa aunque haya una barra ya seleccionada.
  const { search, country } = req.query
  let baseGroups = search ? [
    { filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: search }] },
    { filters: [{ propertyName: 'lastname',  operator: 'CONTAINS_TOKEN', value: search }] },
    { filters: [{ propertyName: 'phone',     operator: 'CONTAINS_TOKEN', value: search }] },
  ] : []
  // El país se agrega con AND a cada rama del OR de búsqueda (o crea una
  // única rama si no había búsqueda activa).
  if (country) {
    const base = baseGroups.length ? baseGroups : [{ filters: [] }]
    baseGroups = base.map(g => ({ filters: [...(g.filters || []), { propertyName: 'country', operator: 'EQ', value: country }] }))
  }

  const countFor = async (key) => {
    try {
      let filterGroups = applyOwnerFilter(req, withQualityFilter(baseGroups, key, CONTACT_QUALITY_FILTERS))
      filterGroups = applyCountryFilter(req, filterGroups, 'country', { translate: true })
      const r = await hs.post('/crm/v3/objects/contacts/search', {
        filterGroups, limit: 1, properties: ['firstname'],
      })
      return r.data.total || 0
    } catch { return 0 }
  }
  const delay = (ms) => new Promise(r => setTimeout(r, ms))

  const metrics = {}
  for (const key of Object.keys(CONTACT_QUALITY_FILTERS)) {
    metrics[key] = await countFor(key)
    await delay(260)
  }
  res.json(metrics)
})

const CONTACT_EXPORT_COLUMNS = [
  { header: 'Nombre',      key: 'nombre',  width: 26 },
  { header: 'Email',       key: 'email',   width: 28 },
  { header: 'Teléfono',    key: 'telefono', width: 18 },
  { header: 'Cargo',       key: 'cargo',   width: 22 },
  { header: 'Empresa',     key: 'empresa', width: 28 },
  { header: 'País',        key: 'pais',    width: 18 },
  { header: 'Anotaciones', key: 'notas',   width: 42 },
  { header: 'Creado',      key: 'creado',  width: 14 },
]

// Reporte Excel del listado de Contactos — mismo criterio que
// /contacts/search (búsqueda, calidad de datos multi-select), pagina todos
// los resultados y arma el .xlsx con logo BePharma + evento activo +
// resumen de filtros.
app.post('/api/hubspot/contacts/export', requireAuth, async (req, res) => {
  try {
    const { filters = [], filterGroups: fgBody, qualityFilter, qualityFilters, filtroResumen } = req.body
    const baseGroups = fgBody || (filters.length ? [{ filters }] : [])
    let filterGroups = applyOwnerFilter(req, baseGroups)
    const qfList = parseQualityFilters(qualityFilters)
    filterGroups = qfList.length
      ? withQualityFilters(filterGroups, qfList, CONTACT_QUALITY_FILTERS)
      : withQualityFilter(filterGroups, qualityFilter, CONTACT_QUALITY_FILTERS)
    filterGroups = applyCountryFilter(req, filterGroups, 'country', { translate: true })

    const MAX_PAGES = 40 // hasta 4000 contactos (100 x 40)
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    const allContacts = []
    let after
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await sleep(260)
      const r = await hs.post('/crm/v3/objects/contacts/search', {
        filterGroups,
        sorts: [{ propertyName: 'firstname', direction: 'ASCENDING' }],
        limit: 100,
        after,
        properties: CONTACT_PROPERTIES,
      })
      allContacts.push(...(r.data.results || []))
      after = r.data.paging?.next?.after
      if (!after) break
    }

    const rows = allContacts.map(c => {
      const p = c.properties || {}
      return {
        nombre: [p.firstname, p.lastname].filter(Boolean).join(' ') || '(sin nombre)',
        email: p.email || '',
        telefono: p.phone || '',
        cargo: p.jobtitle || '',
        empresa: p.company || '',
        pais: p.country || '',
        notas: p.bp_notas_contacto || '',
        creado: p.createdate ? new Date(Number(p.createdate) || p.createdate).toLocaleDateString('es-MX') : '',
      }
    })

    const workbook = await buildReportWorkbook({
      sheetName: 'Contactos',
      title: 'BePharma CRM — Reporte de Contactos',
      eventoActivo: ACTIVE_EVENT,
      filtroResumen,
      generadoPor: req.user?.username,
      columns: CONTACT_EXPORT_COLUMNS,
      rows,
    })
    const buffer = await workbookToBuffer(workbook)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="BePharma_Contactos_${ACTIVE_EVENT}_${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (e) {
    console.error('[contacts/export] Error:', e.response?.data || e.message)
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Contacto – detalle
app.get('/api/hubspot/contacts/:id', requireAuth, async (req, res) => {
  try {
    const r = await hs.get(`/crm/v3/objects/contacts/${req.params.id}`, {
      params: {
        properties: CONTACT_PROPERTIES.join(','),
        associations: 'companies,deals,notes,calls',
      },
    })
    const contact = r.data

    // Deduplicar empresas por ID y enriquecer con nombres
    const rawCompanies = contact.associations?.companies?.results || []
    const uniqueCompanyIds = [...new Set(rawCompanies.map(c => String(c.id)))]
    if (uniqueCompanyIds.length > 0) {
      try {
        const cr = await hs.post('/crm/v3/objects/companies/batch/read', {
          inputs: uniqueCompanyIds.map(id => ({ id })),
          properties: ['name', 'domain', 'bp_participo_eventos'],
        })
        const byId = Object.fromEntries((cr.data.results || []).map(c => [c.id, c]))
        contact.associations.companies.results = uniqueCompanyIds
          .map(id => byId[id])
          .filter(Boolean)
      } catch { /* mantener IDs originales deduplicados */
        contact.associations.companies.results = uniqueCompanyIds.map(id => ({ id }))
      }
    }

    res.json(contact)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Propietarios (usuarios HubSpot)
app.get('/api/hubspot/owners', requireAuth, async (req, res) => {
  try {
    const r = await hs.get('/crm/v3/owners')
    res.json(r.data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Actividades (notas, llamadas, reuniones, emails, tareas) via CRM v3 associations
app.get('/api/hubspot/engagements/:objectType/:objectId', requireAuth, async (req, res) => {
  const { objectType, objectId } = req.params
  const propMap = {
    notes:    ['hs_note_body', 'hs_createdate', 'hs_attachment_ids'],
    calls:    ['hs_call_body', 'hs_call_duration', 'hs_createdate', 'hs_call_status', 'hs_call_direction', 'hs_attachment_ids'],
    meetings: ['hs_meeting_title', 'hs_meeting_body', 'hs_meeting_start_time', 'hs_createdate', 'hs_attachment_ids'],
    emails:   ['hs_email_subject', 'hs_email_text', 'hs_createdate', 'hs_attachment_ids', 'hs_email_to_email', 'hs_email_cc_email'],
    tasks:    ['hs_task_subject', 'hs_task_body', 'hs_createdate', 'hs_task_status', 'hs_attachment_ids']
  }
  const typeLabel = { notes: 'NOTE', calls: 'CALL', meetings: 'MEETING', emails: 'EMAIL', tasks: 'TASK' }
  const allItems = []

  // Resuelve IDs de archivo (hs_attachment_ids, separados por ";") a URLs de
  // descarga firmadas — necesario porque los adjuntos se suben como PRIVATE.
  async function resolveAttachments(rawIds) {
    const fileIds = String(rawIds || '').split(';').map(s => s.trim()).filter(Boolean)
    if (!fileIds.length) return []
    const results = await Promise.all(fileIds.map(fileId =>
      hs.get(`/files/v3/files/${fileId}/signed-url`).then(r => ({
        id: fileId,
        name: r.data.name ? `${r.data.name}${r.data.extension ? '.' + r.data.extension : ''}` : `archivo-${fileId}`,
        url: r.data.url,
        size: r.data.size || null,
      })).catch(err => {
        console.warn(`[engagements] fallo al obtener signed-url de archivo ${fileId}:`, err.response?.status, err.response?.data?.message || err.message)
        return null
      })
    ))
    return results.filter(Boolean)
  }

  await Promise.all(Object.keys(propMap).map(async (engType) => {
    try {
      const assocR = await hs.get(`/crm/v3/objects/${objectType}/${objectId}/associations/${engType}`)
      const ids = (assocR.data.results || []).map(r => r.id).slice(0, 15)
      if (!ids.length) return
      const details = await Promise.all(ids.map(id =>
        hs.get(`/crm/v3/objects/${engType}/${id}`, {
          params: { properties: propMap[engType].join(',') }
        }).catch(detailErr => {
          console.warn(`[engagements] fallo al leer ${engType}/${id}:`, detailErr.response?.status, detailErr.response?.data?.message || detailErr.message)
          return null
        })
      ))
      await Promise.all(details.filter(Boolean).map(async (d) => {
        const p = d.data.properties
        allItems.push({
          id: d.data.id,
          type: typeLabel[engType],
          createdAt: p.hs_createdate || p.hs_meeting_start_time || null,
          body: p.hs_note_body || p.hs_call_body || p.hs_meeting_body || p.hs_email_text || p.hs_task_body || '',
          title: p.hs_meeting_title || p.hs_email_subject || p.hs_task_subject || '',
          durationMs: p.hs_call_duration || null,
          to: p.hs_email_to_email || null,
          cc: p.hs_email_cc_email || null,
          attachments: await resolveAttachments(p.hs_attachment_ids),
        })
      }))
    } catch (assocErr) {
      console.warn(`[engagements] fallo al listar asociaciones ${objectType}/${objectId} -> ${engType}:`, assocErr.response?.status, assocErr.response?.data?.message || assocErr.message)
    }
  }))

  allItems.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  res.json({ results: allItems })
})

// ──────────────────────────────────────────────────────────────────────────────
// PIPELINE DE EVENTOS — Kanban por dealstage
// ──────────────────────────────────────────────────────────────────────────────

// Carga deals del evento activo con nombre de empresa enriquecido
app.get('/api/pipeline/deals', requireAuth, async (req, res) => {
  try {
    const allDeals = []
    let after

    // Hasta 500 eventos (10 páginas x 50) — delay entre páginas para evitar 429
    const MAX_PAGES = 10
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await sleep(300) // 300ms entre páginas → ~3 req/seg < límite HubSpot
      let filterGroups = applyOwnerFilter(req, [{ filters: [activeEventFilter()] }])
      filterGroups = applyCountryFilter(req, filterGroups, 'bp_evento_paises')
      const r = await hs.post('/crm/v3/objects/deals/search', {
        filterGroups,
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        limit: 50,
        after,
        properties: DEAL_PROPERTIES,
      })
      allDeals.push(...(r.data.results || []))
      after = r.data.paging?.next?.after
      if (!after) break
    }
    const truncated = !!after  // true si aun quedan paginas sin cargar (>500)

    // Obtener asociaciones empresa-deal en una sola llamada batch (v4)
    // Evita N llamadas paralelas individuales que causan 429
    const companyIdByDeal = {}
    if (allDeals.length > 0) {
      try {
        const BATCH_SIZE = 100
        for (let i = 0; i < allDeals.length; i += BATCH_SIZE) {
          const chunk = allDeals.slice(i, i + BATCH_SIZE)
          const r = await hs.post('/crm/v4/associations/deals/companies/batch/read', {
            inputs: chunk.map(d => ({ id: d.id })),
          })
          ;(r.data.results || []).forEach(row => {
            const first = row.to?.[0]?.toObjectId
            if (first) companyIdByDeal[row.from.id] = String(first)
          })
        }
      } catch { /* sin empresas */ }
    }

    // Batch read de nombres de empresa para IDs únicos
    const uniqueCompanyIds = [...new Set(Object.values(companyIdByDeal))]
    const companyNames = {}
    if (uniqueCompanyIds.length > 0) {
      const BATCH_SIZE = 100
      for (let i = 0; i < uniqueCompanyIds.length; i += BATCH_SIZE) {
        const chunk = uniqueCompanyIds.slice(i, i + BATCH_SIZE)
        try {
          const r = await hs.post('/crm/v3/objects/companies/batch/read', {
            inputs: chunk.map(id => ({ id })),
            properties: ['name'],
          })
          ;(r.data.results || []).forEach(c => { companyNames[c.id] = c.properties.name || '' })
        } catch { /* sin nombres */ }
      }
    }

    // Merge: agregar companyId y companyName a cada deal
    const enriched = allDeals.map(deal => ({
      ...deal,
      _companyId: companyIdByDeal[deal.id] || null,
      _companyName: companyIdByDeal[deal.id] ? (companyNames[companyIdByDeal[deal.id]] || '') : '',
    }))

    res.json({ results: enriched, total: enriched.length, truncated })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Actualizar dealstage desde el Kanban — con control de permisos
app.patch('/api/pipeline/deals/:id/stage', requireAuth, async (req, res) => {
  try {
    const { stage } = req.body
    if (!stage) return res.status(400).json({ error: 'Falta stage' })

    // Nueva/En Depuración/En Enriquecimiento/Por Contactar las asigna el CRM
    // automáticamente según los datos de contacto (ver autoStage.service.js)
    // — no se pueden arrastrar manualmente en el Kanban a esas columnas.
    if (AUTO_STAGE_KEYS.includes(stage)) {
      return res.status(403).json({
        error: 'Esta etapa se asigna automáticamente según los datos de contacto de la empresa. Solo puedes mover un evento a En Seguimiento, Confirmada o No Participa.',
      })
    }

    // Operadores solo pueden mover sus propios deals
    if (req.user.role === 'operator') {
      const deal = await hs.get(`/crm/v3/objects/deals/${req.params.id}`, {
        params: { properties: 'hubspot_owner_id' },
      })
      if (deal.data.properties.hubspot_owner_id !== String(req.user.ownerId)) {
        return res.status(403).json({ error: 'Solo puedes mover tus propios eventos' })
      }
    }

    const r = await hs.patch(`/crm/v3/objects/deals/${req.params.id}`, {
      properties: { bp_estado_prospeccion: stage },
    })
    res.json(r.data)
  } catch (e) {
    const hsMsg = e.response?.data?.message || e.response?.data?.error || e.message
    res.status(e.response?.status || 500).json({ error: typeof hsMsg === 'string' ? hsMsg : JSON.stringify(hsMsg) })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// CRUD DEALS
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/hubspot/deals', requireAuth, async (req, res) => {
  try {
    const { _companyId, ...rest } = req.body
    const props = { ...rest }
    if (!props.hubspot_owner_id) props.hubspot_owner_id = req.user.ownerId

    // Empresas en lista negra no deben recibir nuevos eventos/deals — se
    // marcan para NO contactar en futuros eventos (ver bp_lista_negra).
    // De paso, se hereda el país de la empresa hacia bp_evento_paises: sin
    // esto el deal nace sin país y desaparece de TODAS las vistas de
    // operador (el filtro de zona usa bp_evento_paises IN [países del
    // operador] — ver applyCountryFilter en api/auth.js), exactamente lo que
    // le pasaba al 100% de los deals viejos antes del backfill manual de
    // 03-jul-2026 (api/scripts/backfill-deal-paises.js). Con esto queda
    // garantizado desde la creación, sin depender de volver a correr ese
    // script cada vez que se cargan deals nuevos.
    if (_companyId) {
      try {
        const companyCheck = await hs.get(`/crm/v3/objects/companies/${_companyId}`, {
          params: { properties: 'name,bp_lista_negra,country' },
        })
        const cp = companyCheck.data?.properties || {}
        if (cp.bp_lista_negra === 'true' || cp.bp_lista_negra === true) {
          return res.status(403).json({
            error: `"${cp.name || 'Esta empresa'}" está en Lista Negra — no se pueden crear nuevos eventos/deals para ella.`,
          })
        }
        if (!props.bp_evento_paises && cp.country) props.bp_evento_paises = cp.country
      } catch (checkErr) {
        // Si la verificación falla por un error transitorio, no bloqueamos la
        // creación (mismo criterio permisivo que el resto del endpoint) —
        // solo logueamos para no ocultar el problema.
        console.warn('[deals] No se pudo verificar lista negra de la empresa:', checkErr.response?.data || checkErr.message)
      }
    }

    const r = await hs.post('/crm/v3/objects/deals', { properties: props })
    const dealId = r.data.id
    // Si viene _companyId, crear la asociación deal → empresa
    let assocError = null
    if (_companyId && dealId) {
      try {
        // Tipo 5 = deal_to_company (HubSpot defined)
        await hs.put(
          `/crm/v3/objects/deals/${dealId}/associations/companies/${_companyId}/5`,
          {},
          { headers: { 'Content-Type': 'application/json' } }
        )
        // El deal recién creado normalmente entra sin bp_estado_prospeccion
        // (o con "nueva" por defecto) — recalcularla ahora mismo según los
        // datos que ya tenga la empresa/sus contactos, para que no se quede
        // en blanco/desactualizada desde el primer momento.
        await recomputeDealStagesForCompany(_companyId)
      } catch (assocErr) {
        assocError = assocErr.response?.data || assocErr.message
        console.warn('[deals] Error asociando empresa:', assocError)
      }
    }
    res.json({ ...r.data, _assocError: assocError })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

app.patch('/api/hubspot/deals/:id', requireAuth, async (req, res) => {
  try {
    // Solo supervisores pueden modificar bp_estado_alerta
    const isOperator = req.user.role === 'operator' || req.headers['x-view-mode'] === 'operator'
    if (isOperator && 'bp_estado_alerta' in req.body) {
      return res.status(403).json({ error: 'Solo los supervisores pueden modificar el estado de alerta.' })
    }
    const { _companyId, ...properties } = req.body
    const r = await hs.patch(`/crm/v3/objects/deals/${req.params.id}`, { properties })
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

app.delete('/api/hubspot/deals/:id', requireAuth, async (req, res) => {
  try {
    await hs.delete(`/crm/v3/objects/deals/${req.params.id}`)
    res.json({ success: true })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// CRUD COMPANIES
// ──────────────────────────────────────────────────────────────────────────────
// Los operadores pueden crear empresas (antes solo supervisores), pero quedan
// en bp_estado_aprobacion="pendiente" hasta que un supervisor las revise —
// se crea automáticamente una tarea para los supervisores avisando de la
// empresa nueva a aprobar. Las empresas creadas por un supervisor quedan
// "aprobada" de una vez (no necesitan revisión de sí mismos).
app.post('/api/hubspot/companies', requireAuth, async (req, res) => {
  try {
    const isOperator = req.user.role === 'operator'
    const properties = { ...req.body }
    properties.bp_estado_aprobacion = isOperator ? 'pendiente' : (properties.bp_estado_aprobacion || 'aprobada')

    const r = await hs.post('/crm/v3/objects/companies', { properties })
    const companyId = r.data?.id

    // Tarea de aprobación para supervisores — best-effort: si falla, la
    // empresa igual queda creada (no se bloquea la creación por esto).
    if (isOperator && companyId) {
      try {
        const allUsers = Object.values(loadUsers())
        const supervisorIds = allUsers.filter(u => u.role === 'supervisor').map(u => u.ownerId)
        const dueDateMs = Date.now() + 24 * 60 * 60 * 1000 // vencimiento: 24h
        await hs.post('/crm/v3/objects/tasks', {
          properties: {
            hs_task_subject: `Aprobar empresa nueva: ${properties.name || '(sin nombre)'}`,
            hs_task_body: `${req.user.name || req.user.username} creó esta empresa y está pendiente de aprobación.`,
            hs_timestamp: new Date(dueDateMs).toISOString(),
            hs_task_reminders: String(dueDateMs),
            hs_task_priority: 'MEDIUM',
            hs_task_status: 'NOT_STARTED',
            hubspot_owner_id: supervisorIds[0] || req.user.ownerId,
          },
          associations: [{
            to: { id: companyId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 192 }],
          }],
        })
      } catch (taskErr) {
        console.warn('[companies] No se pudo crear la tarea de aprobación:', taskErr.response?.data || taskErr.message)
      }
    }

    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

app.patch('/api/hubspot/companies/:id', requireAuth, async (req, res) => {
  try {
    const { _companyId, ...properties } = req.body
    // Solo supervisores pueden aprobar/rechazar empresas
    if (req.user.role === 'operator' && 'bp_estado_aprobacion' in properties) {
      return res.status(403).json({ error: 'Solo los supervisores pueden aprobar o rechazar empresas.' })
    }
    const r = await hs.patch(`/crm/v3/objects/companies/${req.params.id}`, { properties })
    // Si cambió el teléfono/email de la empresa (o cualquier otra edición),
    // recalcular la etapa automática de sus deals — barato hacerlo siempre
    // en vez de detectar qué campo específico cambió.
    await recomputeDealStagesForCompany(req.params.id)
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

app.delete('/api/hubspot/companies/:id', requireAuth, async (req, res) => {
  try {
    await hs.delete(`/crm/v3/objects/companies/${req.params.id}`)
    res.json({ success: true })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// CRUD CONTACTS
// ──────────────────────────────────────────────────────────────────────────────
app.patch('/api/hubspot/contacts/:id', requireAuth, async (req, res) => {
  try {
    const { _companyId, ...properties } = req.body
    const contactId = req.params.id
    const r = await hs.patch(`/crm/v3/objects/contacts/${contactId}`, { properties })

    // Si cambia la empresa: quitar asociaciones anteriores y crear la nueva
    let oldCompanyIds = []
    if (_companyId) {
      try {
        const existing = await hs.get(`/crm/v3/objects/contacts/${contactId}/associations/companies`)
        oldCompanyIds = (existing.data.results || []).map(c => c.id)
        await Promise.all(oldCompanyIds.map(oldId =>
          hs.delete(`/crm/v3/objects/contacts/${contactId}/associations/companies/${oldId}/1`)
            .catch(() => {})
        ))
      } catch {}
      await hs.put(
        `/crm/v3/objects/contacts/${contactId}/associations/companies/${_companyId}/1`,
        {},
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Recalcular la etapa automática de la(s) empresa(s) afectada(s) — la
    // actual (por si cambió teléfono/email de este contacto) y, si se movió
    // de empresa, también la anterior (perdió un dato de contacto).
    try {
      const currentCompanyIds = _companyId ? [_companyId] : await getCompanyIdsForContact(contactId)
      const companiesToRecompute = [...new Set([...currentCompanyIds, ...oldCompanyIds])]
      await Promise.all(companiesToRecompute.map(cid => recomputeDealStagesForCompany(cid)))
    } catch (recomputeErr) {
      console.warn('[contacts] fallo al recalcular etapa automática:', recomputeErr.message)
    }

    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

app.delete('/api/hubspot/contacts/:id', requireAuth, async (req, res) => {
  try {
    // Capturar la(s) empresa(s) asociadas ANTES de borrar — al eliminar el
    // contacto se pierde un dato de contacto, así que la etapa automática
    // de sus deals puede necesitar bajar de nivel.
    const companyIds = await getCompanyIdsForContact(req.params.id)
    await hs.delete(`/crm/v3/objects/contacts/${req.params.id}`)
    await Promise.all(companyIds.map(cid => recomputeDealStagesForCompany(cid)))
    res.json({ success: true })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// CHARTS — datos para gráficas del dashboard
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/hubspot/charts', requireAuth, async (req, res) => {
  // Filtros opcionales que vienen del listado de "Mis eventos" (DealList) y
  // del Dashboard para que las gráficas reflejen lo que el usuario está
  // viendo, no siempre el total sin filtrar. País/búsqueda/operador se
  // aplican siempre a las 3 gráficas (no son ninguna de las dimensiones
  // graficadas). Estado y alerta SÍ se aplican también a su propia gráfica
  // desde el 05-jul-2026 (antes se excluían "para no dejar una sola barra
  // tras un clic", pero eso hacía que elegir un estado/alerta pareciera no
  // hacer nada en su propio gráfico — reportado como bug por Gustavo).
  const { search, ownerFilter, estado, alerta, countryFilter, extraFilters, companyParticipatedBefore } = req.query
  const commonExtra = []
  if (search)        commonExtra.push({ propertyName: 'dealname',         operator: 'CONTAINS_TOKEN', value: search })
  if (ownerFilter)   commonExtra.push({ propertyName: 'hubspot_owner_id', operator: 'EQ',             value: ownerFilter })
  if (countryFilter) commonExtra.push({ propertyName: 'bp_evento_paises', operator: 'EQ',             value: countryFilter })
  // Filtro rápido que viene de un quick-link del Dashboard (p.ej. "Mis
  // callbacks vencidos" / "Sin actividad +72h" en vista operador) — DealList
  // lo aplica al listado via location.state.filter; sin esto, el gráfico se
  // quedaba mostrando el total sin filtrar aunque el listado sí filtrara.
  if (extraFilters) {
    try {
      const parsed = JSON.parse(extraFilters)
      if (Array.isArray(parsed)) commonExtra.push(...parsed)
    } catch { /* ignora JSON invalido */ }
  }

  // estado ahora llega como CSV (checkboxes multi-select en el Dashboard,
  // p.ej. "confirmada,en_seguimiento") — se combina con OR vía operador IN.
  const estadoList = estado ? String(estado).split(',').map(s => s.trim()).filter(Boolean) : []
  const estadoExtra = estadoList.length ? [{ propertyName: 'bp_estado_prospeccion', operator: 'IN', values: estadoList }] : []
  const alertaExtra = alerta
    ? [alerta === 'sin_alerta'
        ? { propertyName: 'bp_estado_alerta', operator: 'NOT_HAS_PROPERTY' }
        : { propertyName: 'bp_estado_alerta', operator: 'EQ', value: alerta }]
    : []

  const fg = (baseFilters, extra = []) => applyCountryFilter(
    req,
    applyOwnerFilter(req, [{ filters: [activeEventFilter(), ...baseFilters, ...commonExtra, ...extra] }]),
    'bp_evento_paises'
  )
  const safe = async (filters, extra = []) => {
    try {
      const data = await searchDealsWithCompanyParticipation({
        filterGroups: fg(filters, extra),
        limit: 1,
        properties: ['dealname'],
        companyParticipatedBefore,
      })
      return data.total || 0
    } catch { return 0 }
  }
  // Pequeña pausa entre queries para no exceder el rate limit de HubSpot (4 req/s)
  const delay = (ms) => new Promise(r => setTimeout(r, ms))

  const now = new Date()
  const months = [0,1,2,3,4,5].map(i => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return {
      label: d.toLocaleString('es-MX', { month: 'short' }),
      startMs: d.getTime(),
      endMs: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
    }
  })

  // Queries secuenciales para respetar el rate limit de HubSpot
  // byStage: incluye alerta activa Y estado activo — si Gustavo selecciona
  // uno o más estados (checkboxes en el Dashboard, <select> en DealList), las
  // demás etapas quedan en 0 y solo las seleccionadas muestran su conteo real
  // (antes se ignoraba `estado` acá "para no dejar una sola barra", pero eso
  // hacía que el filtro pareciera no tener efecto en este gráfico).
  const stageCounts = []
  for (const s of PIPELINE_STAGES) {
    stageCounts.push(await safe([{ propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: s.key }], [...estadoExtra, ...alertaExtra]))
    await delay(260)
  }

  // byMonth: tendencia de creación — incluye todos los filtros activos
  const monthlyCounts = []
  for (const m of months) {
    monthlyCounts.push(await safe([
      { propertyName: 'createdate', operator: 'GTE', value: String(m.startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(m.endMs) },
    ], [...estadoExtra, ...alertaExtra]))
    await delay(260)
  }

  // Distribución por alerta (para el gráfico "Alertas levantadas" de Mis Eventos)
  // incluye estado activo, pero NO alerta (es la propia dimensión)
  const ALERTA_KEYS = [
    { key: 'sin_alerta',      label: 'Sin alerta' },
    { key: 'alerta_amarilla', label: 'Alerta amarilla' },
    { key: 'alerta_roja',     label: 'Alerta roja' },
  ]
  const alertaCounts = []
  for (const a of ALERTA_KEYS) {
    alertaCounts.push(await safe([
      a.key === 'sin_alerta'
        ? { propertyName: 'bp_estado_alerta', operator: 'NOT_HAS_PROPERTY' }
        : { propertyName: 'bp_estado_alerta', operator: 'EQ', value: a.key },
    ], estadoExtra))
    await delay(260)
  }

  res.json({
    byStage: PIPELINE_STAGES.map((s, i) => ({ ...s, count: stageCounts[i] })),
    byMonth: months.map((m, i) => ({ label: m.label, count: monthlyCounts[i] })),
    byAlerta: ALERTA_KEYS.map((a, i) => ({ ...a, count: alertaCounts[i] })),
  })
})

// Admin – lista usuarios con config Zadarma
app.get('/api/admin/users', requireAuth, async (req, res) => {
  const users = loadUsers()
  const isSupervisor = req.user.role === 'supervisor'
  const all = Object.entries(users).map(([username, u]) => ({
    username,
    name: u.name,
    role: u.role,
    ownerId: u.ownerId,
    sipExtension: u.sipExtension || '',
    bp_paises: Array.isArray(u.bp_paises) ? u.bp_paises : [],
    emailUser: u.emailUser || ''
  }))
  // Operadores solo ven su propio perfil
  const safe = isSupervisor ? all : all.filter(u => u.username === req.user.username)
  res.json(safe)
})

// Admin – actualizar extensión SIP de un usuario
app.patch('/api/admin/users/:username/sip', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const users = loadUsers()
    if (!users[req.params.username]) return res.status(404).json({ error: 'Usuario no encontrado' })
    users[req.params.username].sipExtension = req.body.sipExtension || ''
    saveUsers(users)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Admin – actualizar países asignados a un operador
app.patch('/api/admin/users/:username/paises', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const users = loadUsers()
    if (!users[req.params.username]) return res.status(404).json({ error: 'Usuario no encontrado' })
    const paises = req.body.bp_paises
    if (!Array.isArray(paises) || !paises.every(p => typeof p === 'string')) {
      return res.status(400).json({ error: 'bp_paises debe ser un array de strings' })
    }
    users[req.params.username].bp_paises = paises
    saveUsers(users)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Admin — recalcula en lote la etapa automática (Nueva/En Depuración/
// En Enriquecimiento/Por Contactar) de TODOS los deals que estén hoy en una
// etapa automática o sin etapa. Uso: backfill único tras desplegar esta
// funcionalidad, o para resincronizar si algo se editó directo en HubSpot
// sin pasar por el CRM (que es donde vive el recálculo en tiempo real).
//
// LIMITE IMPORTANTE (descubierto 03-jul-2026): esto procesa las empresas
// una por una, secuencial, con varias llamadas a HubSpot por empresa. Con
// unos cientos de empresas esto termina bien, pero con miles (ej. un import
// masivo de un evento nuevo) la ejecución total toma varios minutos y la
// función serverless de Vercel se corta antes de terminar (no hay
// `maxDuration` configurado, y con el `builds` legacy de vercel.json no es
// trivial subirlo). El resultado: cada corrida "arregla" solo el primer
// grupo de empresas antes del corte, y como siempre reprocesa en el mismo
// orden, nunca avanza mas alla de ese primer grupo.
//
// Para backfills grandes (varios cientos+ de empresas pendientes) usar en
// su lugar el script de una sola corrida, sin límite de tiempo:
//   node api/scripts/recompute-auto-stages.js --dry-run
//   node api/scripts/recompute-auto-stages.js --confirm
// Este botón queda bien para recalculos chicos (unas pocas decenas de
// empresas editadas directo en HubSpot).
app.post('/api/admin/recompute-auto-stages', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const filterGroups = [
      { filters: [{ propertyName: 'bp_estado_prospeccion', operator: 'IN', values: AUTO_STAGE_KEYS }] },
      { filters: [{ propertyName: 'bp_estado_prospeccion', operator: 'NOT_HAS_PROPERTY' }] },
    ]

    let allDeals = []
    let after
    while (true) {
      const r = await hs.post('/crm/v3/objects/deals/search', {
        filterGroups, limit: 100, after, properties: ['bp_estado_prospeccion'],
      })
      allDeals.push(...(r.data.results || []))
      after = r.data.paging?.next?.after
      if (!after) break
    }

    const companyIdByDeal = {}
    const BATCH = 100
    for (let i = 0; i < allDeals.length; i += BATCH) {
      const chunk = allDeals.slice(i, i + BATCH)
      const r = await hs.post('/crm/v4/associations/deals/companies/batch/read', {
        inputs: chunk.map(d => ({ id: d.id })),
      })
      ;(r.data.results || []).forEach(row => {
        const first = row.to?.[0]?.toObjectId
        if (first) companyIdByDeal[row.from.id] = String(first)
      })
    }
    const uniqueCompanyIds = [...new Set(Object.values(companyIdByDeal))]

    const results = []
    for (const cid of uniqueCompanyIds) {
      results.push(await recomputeDealStagesForCompany(cid))
      await new Promise(r2 => setTimeout(r2, 150)) // respeta rate limit de HubSpot
    }

    const totalDealsUpdated = results.reduce((sum, r) => sum + (r.updatedDeals?.length || 0), 0)
    const failedCompanies = results.filter(r => r.error).map(r => r.companyId)
    res.json({
      dealsEvaluados: allDeals.length,
      companiesProcesadas: uniqueCompanyIds.length,
      totalDealsActualizados: totalDealsUpdated,
      companiesConError: failedCompanies.length,
      results,
    })
  } catch (e) {
    // HubSpot puede devolver el detalle del error en formas distintas según el
    // endpoint (string, {message}, {errors: [...]}, etc) — nunca dejar que un
    // objeto se cuele crudo en la respuesta (el frontend lo concatenaría como
    // texto y mostraría literalmente "[object Object]").
    const d = e.response?.data
    const msg = (typeof d === 'string' && d)
      || d?.message
      || (Array.isArray(d?.errors) ? d.errors.map(x => x.message || JSON.stringify(x)).join('; ') : null)
      || (d && typeof d === 'object' ? JSON.stringify(d) : null)
      || e.message
      || 'Error desconocido al recalcular etapas'
    console.error('[recompute-auto-stages]', d || e.message)
    res.status(e.response?.status || 500).json({ error: msg })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// BACKUP — copia de seguridad completa del sistema (Empresas/Contactos/Deals
// de HubSpot + configuración propia del CRM: usuarios, firmas, plantillas).
// Ver api/services/backup.service.js para el detalle de qué se incluye
// (deliberadamente sin contraseñas ni EMAIL_PASS).
// ──────────────────────────────────────────────────────────────────────────────

// Descarga on-demand desde el panel de Admin — solo supervisores.
// ?format=xlsx (default) → un .xlsx con una hoja por tipo de dato
// ?format=json           → el JSON crudo (mejor insumo para un futuro restore)
app.get('/api/admin/backup', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const format = req.query.format === 'json' ? 'json' : 'xlsx'
    const data = await buildFullBackupData()

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="BePharma_Backup_${Date.now()}.json"`)
      return res.send(JSON.stringify(data, null, 2))
    }

    const buffer = await buildFullBackupWorkbook(data, req.user?.username)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="BePharma_Backup_${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (e) {
    console.error('[admin/backup] Error:', e.response?.data || e.message)
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Backup automático semanal — disparado por Vercel Cron (ver vercel.json).
// No usa requireAuth (no hay un usuario logueado disparándolo): se protege
// con un secreto propio que Vercel Cron manda como
// header "Authorization: Bearer <CRON_SECRET>".
// Arma el .xlsx y lo envía por correo a cada usuario con role="supervisor"
// en users.json, usando el mismo orden de envío (Resend → SMTP) que ya usa
// el composer de email, con el remitente/destinatario propio de cada
// supervisor (EMAIL_USER_<USERNAME>) — así no depende de un buzón genérico
// del sistema que nadie más revisa.
app.get('/api/cron/backup', async (req, res) => {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron/backup] CRON_SECRET no configurado — rechazando por seguridad')
    return res.status(500).json({ error: 'CRON_SECRET no configurado' })
  }
  const auth = req.headers['authorization'] || ''
  if (auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  try {
    const users = loadUsers()
    const supervisors = Object.entries(users).filter(([, u]) => u.role === 'supervisor')
    if (!supervisors.length) {
      console.warn('[cron/backup] No hay usuarios con role=supervisor — nada que enviar')
      return res.json({ success: true, sent: 0, warning: 'Sin supervisores configurados' })
    }

    const data = await buildFullBackupData()
    const buffer = await buildFullBackupWorkbook(data, 'Backup automático semanal')
    const filename = `BePharma_Backup_${new Date().toISOString().slice(0, 10)}.xlsx`
    const contentBase64 = Buffer.from(buffer).toString('base64')
    const subject = `BePharma CRM — Copia de seguridad semanal (${new Date().toLocaleDateString('es-MX')})`
    const html = `
      <p>Copia de seguridad automática del CRM de BePharma.</p>
      <p>${data.counts.companies} empresas · ${data.counts.contacts} contactos · ${data.counts.deals} eventos · ${data.counts.users} usuarios.</p>
      <p>Adjunto en este correo (.xlsx).</p>
    `

    const results = []
    for (const [username] of supervisors) {
      const to = getUserEmail(username)
      if (!to) {
        console.warn(`[cron/backup] "${username}" es supervisor pero no tiene EMAIL_USER_${username.toUpperCase()} configurado — se omite`)
        results.push({ username, sent: false, reason: 'sin EMAIL_USER_* configurado' })
        continue
      }
      try {
        if (process.env.RESEND_API_KEY) {
          await axios.post('https://api.resend.com/emails', {
            from: `BePharma CRM <${to}>`,
            to: [to],
            subject,
            html,
            attachments: [{ filename, content: contentBase64 }],
          }, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })
        } else {
          const mailer = getUserMailer(username)
          if (!mailer) throw new Error(`sin EMAIL_PASS_${username.toUpperCase()} configurado (modo SMTP)`)
          await mailer.sendMail({
            from: to, to, subject, html,
            attachments: [{ filename, content: contentBase64, encoding: 'base64' }],
          })
        }
        results.push({ username, sent: true })
      } catch (mailErr) {
        console.error(`[cron/backup] Error enviando a "${username}":`, mailErr.response?.data || mailErr.message)
        results.push({ username, sent: false, reason: mailErr.message })
      }
    }

    res.json({ success: true, sent: results.filter(r => r.sent).length, results })
  } catch (e) {
    console.error('[cron/backup] Error:', e.response?.data || e.message)
    res.status(500).json({ error: e.response?.data || e.message })
  }
})

// Crear contacto en HubSpot y opcionalmente asociarlo a una empresa
app.post('/api/hubspot/contacts', requireAuth, async (req, res) => {
  try {
    const { _companyId, ...properties } = req.body
    // Auto-asignar owner para que el contacto aparezca en la vista del operador
    if (!properties.hubspot_owner_id && req.user?.ownerId) {
      properties.hubspot_owner_id = req.user.ownerId
    }
    const r = await hs.post('/crm/v3/objects/contacts', { properties })
    const contactId = r.data.id
    let assocError = null
    // Asociar a empresa usando tipo numérico 1 (CONTACT_TO_COMPANY) + Content-Type explícito
    if (_companyId && contactId) {
      try {
        await hs.put(
          `/crm/v3/objects/contacts/${contactId}/associations/companies/${_companyId}/1`,
          {},
          { headers: { 'Content-Type': 'application/json' } }
        )
        // Nuevo contacto con teléfono/email puede subir la etapa automática
        // de los deals de esta empresa.
        await recomputeDealStagesForCompany(_companyId)
      } catch (assocErr) {
        assocError = assocErr.response?.data || assocErr.message
        console.warn('[contacts] Error asociando empresa:', assocError)
      }
    }
    res.json({ ...r.data, _assocError: assocError })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data?.message || e.message })
  }
})

// Metricas del dashboard usando propiedades BePharma reales.
// Fechas tipo date con LT/GT van en epoch milliseconds (no ISO string).
app.get('/api/hubspot/metrics', requireAuth, async (req, res) => {
  try {
    const now = Date.now()
    const minus72hMs  = now - 72 * 60 * 60 * 1000
    const startOfMonthMs = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()

    const fg = (baseFilters) => applyCountryFilter(
      req,
      applyOwnerFilter(req, [{ filters: [activeEventFilter(), ...baseFilters] }]),
      'bp_evento_paises'
    )

    const safeCount = async (filters) => {
      try {
        const r = await hs.post('/crm/v3/objects/deals/search', {
          filterGroups: fg(filters), limit: 1, properties: ['dealname'],
        })
        return r.data.total || 0
      } catch (err) {
        console.error('[metrics] query error:', err.response?.data || err.message)
        return 0
      }
    }

    const delayMs = (ms) => new Promise(r => setTimeout(r, ms))

    // Distribucion por estado — secuencial para respetar rate limit HubSpot (4 req/s)
    const BP_ESTADOS = ['nueva', 'en_depuracion', 'contacto_enviado', 'en_seguimiento', 'confirmada', 'no_participa']
    const estadoCountsRaw = []
    for (const estado of BP_ESTADOS) {
      estadoCountsRaw.push(await safeCount([{ propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: estado }]))
      await delayMs(260)
    }
    const porEstado = Object.fromEntries(BP_ESTADOS.map((e, i) => [e, estadoCountsRaw[i]]))

    // Métricas principales — secuencial para respetar rate limit HubSpot
    const sinActividad72h = await safeCount([
      { propertyName: 'bp_ultima_actividad_operador', operator: 'LT', value: String(minus72hMs) },
      ...notTerminalFilters(),
    ])
    await delayMs(260)
    const nuevosEsteMes = await safeCount([
      { propertyName: 'createdate', operator: 'GTE', value: String(startOfMonthMs) },
    ])
    await delayMs(260)
    const sinProximoContacto = await safeCount([
      { propertyName: 'bp_proximo_contacto', operator: 'NOT_HAS_PROPERTY' },
      ...notTerminalFilters(),
    ])
    await delayMs(260)
    const callbacksVencidos = await safeCount([
      { propertyName: 'bp_proximo_contacto', operator: 'LT', value: String(now) },
      ...notTerminalFilters(),
    ])
    await delayMs(260)
    const confirmadasBePharma = await safeCount([
      { propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: 'confirmada' },
    ])
    await delayMs(260)
    const participaOtroEvento = await safeCount([
      { propertyName: 'bp_decision_participacion', operator: 'EQ', value: 'participa_otro_evento' },
    ])

    res.json({
      sinActividad72h,
      nuevosEsteMes,
      sinProximoContacto,
      callbacksVencidos,
      confirmadasBePharma,
      participaOtroEvento,
      porEstado,
      eventoActivo: ACTIVE_EVENT,
    })
  } catch (e) {
    console.error('[metrics] fatal:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Tareas pendientes del usuario actual — incluye asociaciones para navegar al hacer clic
app.get('/api/hubspot/tasks/pending', requireAuth, async (req, res) => {
  try {
    const actAsOperator = req.user.role === 'operator' || req.headers['x-view-mode'] === 'operator'
    const ownerFilter = actAsOperator
      ? [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: req.user.ownerId }]
      : []

    const r = await hs.post('/crm/v3/objects/tasks/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'hs_task_status', operator: 'EQ', value: 'NOT_STARTED' },
          ...ownerFilter
        ]
      }],
      sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
      limit: 20,
      properties: ['hs_task_subject', 'hs_task_body', 'hs_timestamp', 'hs_task_priority', 'hs_task_status', 'hubspot_owner_id']
    })

    const tasks = r.data.results || []

    // Enriquecer cada tarea con su primera asociación (deal, contact o company)
    const enriched = await Promise.all(tasks.map(async (task) => {
      try {
        // Busca asociaciones: primero deals, luego contacts, luego companies
        for (const [assocType, path] of [['deals', 'deals'], ['contacts', 'contacts'], ['companies', 'companies']]) {
          const assocR = await hs.get(`/crm/v3/objects/tasks/${task.id}/associations/${assocType}`)
          const ids = assocR.data.results || []
          if (ids.length > 0) {
            const firstId = ids[0].id
            // Obtener nombre del objeto asociado
            const propMap = {
              deals: 'dealname',
              contacts: 'firstname,lastname',
              companies: 'name'
            }
            const objR = await hs.get(`/crm/v3/objects/${assocType}/${firstId}`, {
              params: { properties: propMap[assocType] }
            })
            const p = objR.data.properties
            const name = assocType === 'contacts'
              ? [p.firstname, p.lastname].filter(Boolean).join(' ') || `Contacto #${firstId}`
              : p[propMap[assocType].split(',')[0]] || `#${firstId}`
            return {
              ...task,
              _assoc: { type: assocType, id: firstId, name }
            }
          }
        }
      } catch { /* sin asociación */ }
      return task
    }))

    res.json({ ...r.data, results: enriched })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// ZADARMA
// ──────────────────────────────────────────────────────────────────────────────
function zadarmaSign(method, params) {
  // Replicar http_build_query de PHP: keys ordenadas, valores URL-encoded
  const sortedKeys = Object.keys(params).sort()
  const paramStr = sortedKeys
    .map(k => `${k}=${encodeURIComponent(String(params[k])).replace(/%20/g, '+')}`)
    .join('&')
  const str = method + paramStr + md5(paramStr)
  // Zadarma's PHP example uses base64_encode(hash_hmac(...)) where hash_hmac
  // returns a hex string by default. Match that exactly instead of base64 raw bytes.
  const hmacHex = crypto.createHmac('sha1', process.env.ZADARMA_API_SECRET).update(str).digest('hex')
  return Buffer.from(hmacHex).toString('base64')
}
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

async function zadarmaRequest(method, params = {}) {
  const sign = zadarmaSign(method, params)
  // El query string debe tener las mismas claves ORDENADAS que se usaron para firmar
  const sortedKeys = Object.keys(params).sort()
  const qs = sortedKeys
    .map(k => `${k}=${encodeURIComponent(String(params[k])).replace(/%20/g, '+')}`)
    .join('&')
  const r = await axios.get(`https://api.zadarma.com${method}?${qs}`, {
    headers: { Authorization: `${process.env.ZADARMA_API_KEY}:${sign}` }
  })
  return r.data
}

function cleanZadarmaPhone(value) {
  const raw = String(value || '').trim()
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (!cleaned) return ''
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`
  if (cleaned.startsWith('+')) return `+${cleaned.slice(1).replace(/\D/g, '')}`
  return cleaned.replace(/\D/g, '')
}

function cleanZadarmaFrom(value) {
  return String(value || '').trim().replace(/\D/g, '')
}

function isZadarmaOnline(value) {
  return String(value).toLowerCase() === 'true' || value === true || value === 1 || value === '1'
}

function readableApiError(error) {
  const data = error.response?.data
  if (!data) return error.message || 'Error desconocido'
  if (typeof data === 'string') return data
  return data.message || data.error || JSON.stringify(data)
}

function zadarmaErrorPayload(e, fallback = 'Error de Zadarma') {
  const status = e.response?.status || 500
  const zadarma = e.response?.data || null
  const remoteMessage = zadarma?.message || zadarma?.error || e.message
  const isAuthError = status === 401 || /not authorized/i.test(String(remoteMessage || ''))
  return {
    httpStatus: isAuthError ? 401 : 500,
    body: {
      error: isAuthError
        ? 'Zadarma no autorizo la solicitud. Revisa ZADARMA_API_KEY y ZADARMA_API_SECRET en Vercel.'
        : fallback,
      details: remoteMessage,
      zadarma,
      status,
    }
  }
}

// Iniciar llamada click-to-call
app.post('/api/zadarma/call', requireAuth, async (req, res) => {
  try {
    const from = cleanZadarmaFrom(req.body.from)
    const to = cleanZadarmaPhone(req.body.to)
    const predicted = Number(req.body.predicted || 0)

    if (!from) return res.status(400).json({ error: 'Tu usuario no tiene extension SIP/PBX configurada.' })
    if (!/^\d{3,20}$/.test(from)) return res.status(400).json({ error: 'La extension SIP/PBX no es valida.', details: `Valor recibido: ${req.body.from || ''}` })
    if (!to || !/^\+?\d{7,15}$/.test(to)) return res.status(400).json({ error: 'Numero destino no valido.', details: 'Usa formato internacional, por ejemplo +525500000000.' })

    let extensionStatus = null
    if (/^\d{3}$/.test(from)) {
      try {
        extensionStatus = await zadarmaRequest(`/v1/pbx/internal/${from}/status/`, {})
        if (extensionStatus?.status === 'success' && !isZadarmaOnline(extensionStatus.is_online)) {
          return res.status(409).json({
            error: `La extension ${from} no esta conectada en Zadarma.`,
            details: 'Abre el softphone/app de Zadarma con esa extension y espera a que aparezca online. Luego intenta llamar de nuevo.',
            zadarma: extensionStatus,
          })
        }
      } catch (statusError) {
        const remoteStatus = statusError.response?.status
        if (remoteStatus === 404 || remoteStatus === 400) {
          return res.status(400).json({
            error: `La extension ${from} no existe o no esta disponible en la centralita Zadarma.`,
            details: 'Revisa la extension asignada al usuario en Administracion > Telefonia.',
            zadarma: statusError.response?.data || null,
          })
        }
        console.warn('[zadarma/call] No se pudo verificar estado PBX:', statusError.response?.data || statusError.message)
      }
    }

    const params = { from, to }
    if (predicted) params.predicted = predicted
    const data = await zadarmaRequest('/v1/request/callback/', params)
    if (data?.status && data.status !== 'success') {
      return res.status(502).json({
        error: 'Zadarma no acepto el callback.',
        details: data.message || data.error || 'Respuesta inesperada de Zadarma.',
        zadarma: data,
      })
    }

    res.json({
      ok: true,
      status: data?.status || 'success',
      message: `Callback enviado a la extension ${from}. Contesta esa llamada para conectar con ${to}.`,
      from,
      to,
      zadarma: data,
      extensionStatus,
    })
  } catch (e) {
    const payload = zadarmaErrorPayload(e, 'No se pudo iniciar la llamada')
    res.status(payload.httpStatus).json(payload.body)
  }
})

// Diagnóstico: muestra si las env vars de Zadarma están configuradas
app.get('/api/zadarma/config', requireAuth, (req, res) => {
  const key = process.env.ZADARMA_API_KEY
  const secret = process.env.ZADARMA_API_SECRET
  res.json({
    hasKey: !!key,
    keyPreview: key ? key.substring(0, 6) + '...' : '(no configurado)',
    hasSecret: !!secret,
    secretPreview: secret ? secret.substring(0, 6) + '...' : '(no configurado)',
  })
})

// Diagnóstico: verifica credenciales Zadarma (sin hacer llamadas)
app.get('/api/zadarma/test', requireAuth, async (req, res) => {
  try {
    const data = await zadarmaRequest('/v1/info/balance/', {})
    res.json({ ok: true, balance: data })
  } catch (e) {
    const payload = zadarmaErrorPayload(e, 'No se pudo validar Zadarma')
    res.status(payload.httpStatus).json({ ok: false, ...payload.body })
  }
})

// Historial de llamadas
app.get('/api/zadarma/calls', requireAuth, async (req, res) => {
  try {
    const { start, end, skip = 0, limit = 20, type = 'all' } = req.query
    const now = new Date()
    const data = await zadarmaRequest('/v1/statistics/', {
      start: start || new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0,10),
      end: end || now.toISOString().slice(0,10),
      skip, limit, type
    })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Estado de la línea / extensiones
app.get('/api/zadarma/sip', async (req, res) => {
  try {
    const data = await zadarmaRequest('/v1/sip/')
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// APOLLO.IO
// ──────────────────────────────────────────────────────────────────────────────
// Docs: https://docs.apollo.io/reference/people-api-search
// • Base URL: https://api.apollo.io/api/v1  (incluye /api/)
// • Endpoint mixed_people/api_search: parámetros van en QUERY STRING (in: query), no en body
// • Requiere "master API key" en Apollo Settings → API Keys
const apollo = axios.create({
  baseURL: 'https://api.apollo.io/api/v1',
  headers: {
    'x-api-key': process.env.APOLLO_API_KEY,
    'Cache-Control': 'no-cache'
  }
})

// Buscar personas en Apollo
app.post('/api/apollo/people/search', requireAuth, async (req, res) => {
  try {
    const { name, organization_name, organization_domain, title, titles, location, page = 1 } = req.body
    const clean = (v) => String(v || '').trim()
    const domain = clean(organization_domain || organization_name).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    const looksLikeDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
    const titleList = Array.isArray(titles)
      ? titles.map(clean).filter(Boolean)
      : clean(title).split(',').map(t => t.trim()).filter(Boolean)

    // Params van en query string (no en body) según OpenAPI spec.
    // Importante: q_organization_domains_list[] solo acepta dominios, no nombres de empresa.
    const params = { page, per_page: 25 }
    if (name) params.q_keywords = name
    if (looksLikeDomain) params['q_organization_domains_list[]'] = domain
    if (titleList.length) {
      params['person_titles[]'] = titleList
      params.include_similar_titles = false
    }
    if (location) params['person_locations[]'] = location

    // Si el usuario dio nombre de empresa, buscar primero organizaciones y usar organization_ids[].
    if (!looksLikeDomain && organization_name) {
      try {
        const orgR = await apollo.post('/mixed_companies/search', null, {
          params: {
            q_organization_name: organization_name,
            page: 1,
            per_page: 5,
          }
        })
        const ids = (orgR.data.organizations || orgR.data.accounts || [])
          .map(o => o.id || o.organization_id)
          .filter(Boolean)
          .slice(0, 5)
        if (ids.length) params['organization_ids[]'] = ids
        else params.q_keywords = [params.q_keywords, organization_name].filter(Boolean).join(' ')
      } catch (orgErr) {
        console.warn('[apollo] organization lookup failed:', orgErr.response?.data || orgErr.message)
        params.q_keywords = [params.q_keywords, organization_name].filter(Boolean).join(' ')
      }
    }

    const r = await apollo.post('/mixed_people/api_search', null, { params })
    res.json(r.data)
  } catch (e) {
    const errData = e.response?.data
    const errMsg = errData?.error || errData?.message || e.message
    // 403 con API_INACCESSIBLE = necesita master API key en Apollo
    const hint = errData?.error_code === 'API_INACCESSIBLE'
      ? 'Necesitas una "master API key" en Apollo → Settings → API Keys'
      : undefined
    res.status(e.response?.status || 500).json({
      error: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
      hint,
      _debug: { status: e.response?.status, data: errData }
    })
  }
})

// Enriquecer contacto con email
app.post('/api/apollo/enrich', requireAuth, async (req, res) => {
  try {
    const r = await apollo.post('/people/match', req.body)
    res.json(r.data)
  } catch (e) {
    const errData = e.response?.data
    const msg = errData?.error || errData?.message || e.message
    res.status(e.response?.status || 500).json({ error: typeof msg === 'string' ? msg : JSON.stringify(msg) })
  }
})

// Buscar empresas en Apollo
app.post('/api/apollo/organizations/search', async (req, res) => {
  try {
    const r = await apollo.post('/accounts/search', req.body)
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// ROCKETREACH
// ──────────────────────────────────────────────────────────────────────────────
// Docs: https://docs.rocketreach.co/reference/people-search-api
// • Base URL: https://api.rocketreach.co/api/v2  (incluye /api/)
// • Endpoint: /person/search
// • Campos correctos: employer (no current_employer), geo (no location)
const rr = axios.create({
  baseURL: 'https://api.rocketreach.co/api/v2',
  headers: { 'Api-Key': process.env.ROCKETREACH_API_KEY, 'Content-Type': 'application/json' }
})

// Buscar persona en RocketReach
app.post('/api/rocketreach/search', requireAuth, async (req, res) => {
  try {
    const { name, current_employer, title, location } = req.body
    const titleList = String(title || '').split(',').map(t => t.trim()).filter(Boolean)
    const query = {}
    if (name)             query.name          = [name]
    if (current_employer) query.employer       = [current_employer]  // ← "employer", no "current_employer"
    if (titleList.length) query.current_title  = titleList
    if (location)         query.geo            = [location]          // ← "geo", no "location"
    const r = await rr.post('/person/search', { query, start: 1, page_size: 25 })
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Lookup de contacto (obtiene emails y teléfonos)
app.post('/api/rocketreach/lookup', async (req, res) => {
  try {
    const r = await rr.get('/api/lookupProfile', { params: req.body })
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// EMAIL — credenciales por usuario
// ──────────────────────────────────────────────────────────────────────────────
function getUserMailer(username) {
  const key = username.toUpperCase()
  const emailUser = process.env[`EMAIL_USER_${key}`]
  const emailPass = process.env[`EMAIL_PASS_${key}`]
  if (!emailUser || !emailPass) return null
  const port = parseInt(process.env.SMTP_PORT || '465')
  // SMTP_AUTH_USER permite separar el usuario de autenticación SMTP (ej: "resend")
  // del email de origen (EMAIL_USER_*). Si no está definido, usa EMAIL_USER_*.
  const smtpAuthUser = process.env.SMTP_AUTH_USER || emailUser
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: smtpAuthUser, pass: emailPass },
    tls: { rejectUnauthorized: false },
  })
}

function getUserEmail(username) {
  return process.env[`EMAIL_USER_${username.toUpperCase()}`] || null
}

// ── Microsoft Graph helpers ────────────────────────────────────────────────────
async function getMsGraphToken() {
  const tenantId  = process.env.AZURE_TENANT_ID
  const clientId  = process.env.AZURE_CLIENT_ID
  const clientSec = process.env.AZURE_CLIENT_SECRET
  if (!tenantId || !clientId || !clientSec) return null

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSec,
    scope:         'https://graph.microsoft.com/.default'
  })
  const r = await axios.post(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  return r.data.access_token
}

async function sendViaGraph(fromEmail, senderName, to, subject, bodyHtml, attachments = [], cc = [], bcc = [], replyTo = null) {
  const token = await getMsGraphToken()
  if (!token) throw new Error('Azure no configurado (AZURE_TENANT_ID / CLIENT_ID / CLIENT_SECRET)')

  // "to" puede venir como string único o como array de varias direcciones
  // (selección múltiple de destinatarios precargados en el composer)
  const toList = Array.isArray(to) ? to : String(to).split(/[,;]/).map(s => s.trim()).filter(Boolean)

  const message = {
    subject,
    body: { contentType: 'HTML', content: bodyHtml },
    toRecipients: toList.map(addr => ({ emailAddress: { address: addr } })),
    from: { emailAddress: { name: senderName, address: fromEmail } }
  }
  if (cc.length) {
    message.ccRecipients = cc.map(addr => ({ emailAddress: { address: addr } }))
  }
  if (bcc.length) {
    message.bccRecipients = bcc.map(addr => ({ emailAddress: { address: addr } }))
  }
  if (replyTo) {
    message.replyTo = [{ emailAddress: { address: replyTo } }]
  }
  if (attachments.length) {
    message.attachments = attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.content, // base64, sin prefijo data:
    }))
  }

  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`,
    { message, saveToSentItems: true },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  )
}

// Verificar config de email del usuario autenticado
app.get('/api/email/verify', requireAuth, async (req, res) => {
  // Modo Resend API
  if (process.env.RESEND_API_KEY) {
    const fromEmail = getUserEmail(req.user.username) || process.env.RESEND_FROM || 'onboarding@resend.dev'
    return res.json({ ok: true, user: fromEmail, mode: 'resend' })
  }

  const emailUser = getUserEmail(req.user.username)
  if (!emailUser) return res.json({ ok: false, error: 'no_config' })

  // Modo Graph: verificar que las 3 variables de Azure están presentes
  if (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET) {
    return res.json({ ok: true, user: emailUser, mode: 'graph' })
  }

  // Fallback: SMTP
  const mailer = getUserMailer(req.user.username)
  if (!mailer) return res.json({ ok: false, error: 'no_config' })
  try {
    await mailer.verify()
    res.json({ ok: true, user: emailUser, mode: 'smtp' })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// ── Firma de email por usuario ──────────────────────────────────────────────
const SIGNATURE_MAX_CHARS = 400_000 // ~300KB de HTML/imagen en base64

app.get('/api/email/signature', requireAuth, async (req, res) => {
  try {
    const sig = await getSignature(req.user.username)
    res.json({ html: sig?.html || '', persisted: kvEnabled() })
  } catch (e) {
    console.warn('[signature] error al leer:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/email/signature', requireAuth, async (req, res) => {
  try {
    const { html } = req.body
    if (typeof html !== 'string') return res.status(400).json({ error: 'Falta html' })
    if (html.length > SIGNATURE_MAX_CHARS) {
      return res.status(400).json({ error: 'La firma es muy pesada (reduce el tamaño de la imagen) — máx. ~300KB' })
    }
    await saveSignature(req.user.username, { html, updatedAt: new Date().toISOString() })
    res.json({ success: true, persisted: kvEnabled() })
  } catch (e) {
    console.warn('[signature] error al guardar:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Plantillas de email por usuario ─────────────────────────────────────────
// Lista completa de { id, name, subject, bodyHtml } por usuario — el cliente
// maneja el array (agregar/editar/eliminar) y guarda la lista completa con
// un solo PUT, igual de simple que la firma de arriba.
const TEMPLATES_MAX_COUNT = 30
const TEMPLATES_MAX_CHARS = 500_000

app.get('/api/email/templates', requireAuth, async (req, res) => {
  try {
    const templates = await getEmailTemplates(req.user.username)
    res.json({ templates, persisted: templatesKvEnabled() })
  } catch (e) {
    console.warn('[email-templates] error al leer:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/email/templates', requireAuth, async (req, res) => {
  try {
    const { templates } = req.body
    if (!Array.isArray(templates)) return res.status(400).json({ error: 'Falta templates (array)' })
    if (templates.length > TEMPLATES_MAX_COUNT) {
      return res.status(400).json({ error: `Máximo ${TEMPLATES_MAX_COUNT} plantillas` })
    }
    if (JSON.stringify(templates).length > TEMPLATES_MAX_CHARS) {
      return res.status(400).json({ error: 'Las plantillas ocupan demasiado espacio — reduce el contenido' })
    }
    await saveEmailTemplates(req.user.username, templates)
    res.json({ success: true, persisted: templatesKvEnabled() })
  } catch (e) {
    console.warn('[email-templates] error al guardar:', e.message)
    res.status(500).json({ error: e.message })
  }
})


// Mailbox interno - bandeja tipo Outlook alimentada por Resend + envios del CRM
function stripEmailHtml(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
function findUserByOwnerId(ownerId) {
  const users = loadUsers()
  return Object.entries(users).find(([, u]) => String(u.ownerId || '') === String(ownerId || ''))
}
function mailboxKeyForUsername(username) {
  return String(username || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '-')
}
function findUserByMailboxKey(key) {
  const normalized = String(key || '').toLowerCase()
  const users = loadUsers()
  return Object.entries(users).find(([username]) => mailboxKeyForUsername(username) === normalized)
}

async function fetchReceivedEmailBody(emailId) {
  if (!emailId || !process.env.RESEND_API_KEY) return { html: '', text: '', attachments: [], messageId: '' }
  try {
    const detailR = await axios.get(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      params: { html_format: 'data_uri' },
    })
    const data = detailR.data?.data || detailR.data || {}
    return {
      html: data.html || data.html_body || data.body?.html || '',
      text: data.text || data.text_body || data.body?.text || '',
      attachments: data.attachments || [],
      messageId: data.message_id || '',
    }
  } catch (err) {
    console.warn('[mailbox] fallo al pedir detalle Resend:', err.response?.data || err.message)
    return { html: '', text: '', attachments: [], messageId: '', error: err.response?.data || err.message }
  }
}

async function mailboxDealPatch(dealId) {
  const r = await hs.get(`/crm/v3/objects/deals/${dealId}`, { params: { properties: 'dealname,hubspot_owner_id' } })
  return {
    dealId: String(dealId),
    dealName: r.data?.properties?.dealname || '',
  }
}

function mailboxOwnerFromDealId(dealId) {
  return hs.get(`/crm/v3/objects/deals/${dealId}`, { params: { properties: 'dealname,hubspot_owner_id' } })
    .then(r => {
      const ownerId = r.data?.properties?.hubspot_owner_id || ''
      const found = findUserByOwnerId(ownerId)
      return {
        ownerId,
        ownerUsername: found?.[0] || '',
        ownerName: found?.[1]?.name || '',
        dealName: r.data?.properties?.dealname || '',
      }
    })
    .catch(() => ({ ownerId: '', ownerUsername: '', ownerName: '', dealName: '' }))
}

// Al "vincular" un mensaje del buzon interno a un deal, no basta con marcar
// el campo dealId en el store (bp_email_mailbox): la pestaña Actividades del
// deal (DealDetail.jsx -> /api/hubspot/engagements/deals/:id) lee SOLO las
// asociaciones reales de HubSpot (/crm/v3/objects/deals/:id/associations/emails),
// nunca el store interno. Sin este paso el mensaje queda "vinculado" en el
// buzon pero invisible en el deal.
//   - Si el mensaje ya tiene hubspotEmailId (fue logueado por el webhook de
//     Resend en /api/webhooks/resend-inbound) solo le agregamos la asociacion
//     al deal.
//   - Si NO tiene hubspotEmailId (p.ej. mensajes traidos por el boton
//     "Sincronizar" /api/mailbox/sync-resend, que solo escriben el store
//     interno y nunca crearon un engagement en HubSpot) lo creamos de cero,
//     asociado al deal desde el principio.
const MAILBOX_ASSOC_TYPE_ID = { deals: 210, contacts: 198 }
async function ensureMailboxMessageInHubspotDeal(msg, dealId) {
  if (msg.hubspotEmailId) {
    try {
      await hs.put(`/crm/v3/objects/emails/${msg.hubspotEmailId}/associations/deals/${dealId}/${MAILBOX_ASSOC_TYPE_ID.deals}`)
      return { hubspotEmailId: msg.hubspotEmailId }
    } catch (err) {
      console.warn(`[mailbox] fallo asociando email ${msg.hubspotEmailId} al deal ${dealId}:`, err.response?.data?.message || err.message)
      return {}
    }
  }
  try {
    const toList = (Array.isArray(msg.to) ? msg.to : [msg.to]).filter(Boolean)
    const associations = [{ to: { id: Number(dealId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: MAILBOX_ASSOC_TYPE_ID.deals }] }]
    if (msg.contactId) associations.push({ to: { id: Number(msg.contactId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: MAILBOX_ASSOC_TYPE_ID.contacts }] })
    const emailPayload = {
      properties: {
        hs_timestamp: msg.createdAt || new Date().toISOString(),
        hs_email_direction: msg.direction === 'outbound' ? 'EMAIL' : 'INCOMING_EMAIL',
        hs_email_status: 'SENT',
        hs_email_subject: msg.subject || '(sin asunto)',
        hs_email_text: msg.text || stripEmailHtml(msg.html) || '',
        hs_email_html: msg.html || '',
        hs_email_headers: JSON.stringify({
          from: { email: msg.from || '' },
          to: toList.map(email => ({ email })),
          cc: [],
          bcc: [],
        }),
      },
      associations,
    }
    const createR = await hs.post('/crm/v3/objects/emails', emailPayload)
    return { hubspotEmailId: createR.data.id }
  } catch (err) {
    console.warn(`[mailbox] fallo creando engagement de email para el deal ${dealId}:`, err.response?.data?.message || err.message)
    return {}
  }
}

app.get('/api/mailbox/messages', requireAuth, async (req, res) => {
  try {
    const data = await listMailboxMessages(req.user, req.query)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/mailbox/threads/:threadId', requireAuth, async (req, res) => {
  try {
    const data = await getMailboxThread(req.user, req.params.threadId)
    for (const msg of data.messages || []) {
      if (msg.resendEmailId && !msg.html && !msg.text) {
        const detail = await fetchReceivedEmailBody(msg.resendEmailId)
        if (detail.html || detail.text) {
          const patch = {
            html: detail.html,
            text: detail.text,
            preview: (detail.text || stripEmailHtml(detail.html)).slice(0, 260),
            messageId: msg.messageId || detail.messageId || '',
            attachments: detail.attachments || [],
          }
          const updated = await patchMailboxMessage(req.user, msg.id, patch)
          if (updated) Object.assign(msg, updated)
        }
      }
    }
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/mailbox/messages/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['read', 'readAt', 'archived', 'folder', 'dealId', 'contactId', 'companyId', 'dealName', 'companyName', 'ownerId', 'ownerUsername', 'ownerName', 'html', 'text', 'preview', 'messageId', 'attachments']
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)))
    const msg = await patchMailboxMessage(req.user, req.params.id, patch)
    if (msg === false) return res.status(403).json({ error: 'No autorizado' })
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' })
    res.json({ message: msg })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})


app.delete('/api/mailbox/messages/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await deleteMailboxMessage(req.user, req.params.id)
    if (deleted === false) return res.status(403).json({ error: 'No autorizado' })
    if (!deleted) return res.status(404).json({ error: 'Mensaje no encontrado' })
    res.json({ success: true, deleted })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/mailbox/threads/:threadId', requireAuth, async (req, res) => {
  try {
    const deleted = await deleteMailboxThread(req.user, req.params.threadId)
    if (!deleted) return res.status(404).json({ error: 'Hilo no encontrado' })
    res.json({ success: true, deleted })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/mailbox/messages/:id/link-deal', requireAuth, async (req, res) => {
  try {
    const { dealId } = req.body || {}
    if (!dealId) return res.status(400).json({ error: 'Falta dealId' })
    const dealPatch = await mailboxDealPatch(dealId)
    const msg = await patchMailboxMessage(req.user, req.params.id, dealPatch)
    if (msg === false) return res.status(403).json({ error: 'No autorizado' })
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' })
    const hsResult = await ensureMailboxMessageInHubspotDeal(msg, dealId)
    if (hsResult.hubspotEmailId && hsResult.hubspotEmailId !== msg.hubspotEmailId) {
      await patchMailboxMessage(req.user, msg.id, { hubspotEmailId: hsResult.hubspotEmailId })
      msg.hubspotEmailId = hsResult.hubspotEmailId
    }
    res.json({ success: true, message: msg, syncedToHubspot: !!hsResult.hubspotEmailId })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data?.message || e.message })
  }
})

app.post('/api/mailbox/threads/:threadId/link-deal', requireAuth, async (req, res) => {
  try {
    const { dealId } = req.body || {}
    if (!dealId) return res.status(400).json({ error: 'Falta dealId' })
    const dealPatch = await mailboxDealPatch(dealId)
    const updatedMessages = await patchMailboxThread(req.user, req.params.threadId, dealPatch)
    if (!updatedMessages.length) return res.status(404).json({ error: 'Hilo no encontrado' })
    let synced = 0
    for (const msg of updatedMessages) {
      const hsResult = await ensureMailboxMessageInHubspotDeal(msg, dealId)
      if (hsResult.hubspotEmailId && hsResult.hubspotEmailId !== msg.hubspotEmailId) {
        await patchMailboxMessage(req.user, msg.id, { hubspotEmailId: hsResult.hubspotEmailId })
      }
      if (hsResult.hubspotEmailId) synced += 1
    }
    res.json({ success: true, updated: updatedMessages.length, synced, deal: dealPatch })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data?.message || e.message })
  }
})

app.post('/api/mailbox/sync-resend', requireAuth, async (req, res) => {
  if (!process.env.RESEND_API_KEY) return res.status(400).json({ error: 'RESEND_API_KEY no configurado' })
  try {
    const r = await axios.get('https://api.resend.com/emails/receiving', {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    })
    const received = r.data?.data || []
    let saved = 0
    for (const item of received.slice(0, 50)) {
      const toList = Array.isArray(item.to) ? item.to : []
      const toMatch = toList.map(String).find(addr => /^(deal|contact)-\d+@|^mailbox-[^@]+@/i.test(addr))
      const parsed = toMatch ? toMatch.match(/^(?:(deal|contact)-(\d+)|mailbox-([^@]+))@/i) : null
      const targetType = parsed?.[1] || (parsed?.[3] ? 'mailbox' : null)
      const targetId = parsed?.[2]
      const mailboxKey = parsed?.[3]
      const mailboxUser = mailboxKey ? findUserByMailboxKey(mailboxKey) : null
      const dealId = targetType === 'deal' ? targetId : null
      const ownerInfo = dealId ? await mailboxOwnerFromDealId(dealId) : (mailboxUser ? { ownerUsername: mailboxUser[0], ownerName: mailboxUser[1]?.name || '', ownerId: mailboxUser[1]?.ownerId || '' } : {})
      await upsertMailboxMessage({
        id: `resend_in_${item.id}`,
        resendEmailId: item.id,
        provider: 'resend',
        direction: 'inbound',
        folder: 'inbox',
        subject: item.subject || '(sin asunto)',
        from: item.from || '',
        to: toList,
        cc: item.cc || [],
        messageId: item.message_id || '',
        createdAt: item.created_at || new Date().toISOString(),
        preview: 'Sincronizado desde Resend. Abre el hilo para cargar el cuerpo completo.',
        dealId,
        contactId: targetType === 'contact' ? targetId : null,
        ...ownerInfo,
      })
      saved += 1
    }
    res.json({ success: true, saved, total: received.length })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})
// Admin: lista de usuarios con estado de email configurado
app.get('/api/admin/email-status', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  const users = loadUsers()
  const status = Object.keys(users).map(username => ({
    username,
    name: users[username].name,
    emailUser: getUserEmail(username) || '',
    configured: !!getUserEmail(username)
  }))
  res.json(status)
})

// Sube un adjunto (base64) a la Files API de HubSpot y devuelve su fileId.
// Requiere que el Private App tenga el scope "files" habilitado.
async function uploadFileToHubSpot(filename, contentType, base64) {
  const form = new FormData()
  form.append('file', Buffer.from(base64, 'base64'), { filename, contentType: contentType || 'application/octet-stream' })
  form.append('options', JSON.stringify({ access: 'PRIVATE' }))
  form.append('folderPath', '/bepharma-crm-adjuntos')
  const r = await hs.post('/files/v3/files', form, { headers: form.getHeaders() })
  return r.data.id
}

// Enviar email + registrar en HubSpot como engagement
const ATTACHMENTS_MAX_TOTAL_B64 = 3_500_000 // ~2.6MB reales — deja margen bajo el límite de 4mb del body

// Dirección BCC de HubSpot (Configuración → Objects → Activities → Email Log &
// Track → Manual Logging → BCC Address). Agregarla en BCC a cada correo saliente
// hace que HubSpot registre el envío con from/to correctos (en vez del engagement
// "a mano" que ya hacíamos). OJO: probado en producción — esto por sí solo NO
// activa el reply-logging automático de HubSpot, porque ese requiere que el
// correo se haya mandado "a través del CRM" o del Sales add-in con el checkbox
// Log (ver knowledge.hubspot.com/connected-email/log-email-replies-in-the-crm) —
// algo que no existe como API pública, así que un envío por Resend/Graph nunca
// va a calificar. Por eso se agregó además la captura propia de respuestas más
// abajo (RESEND_INBOUND_DOMAIN + /api/webhooks/resend-inbound).
const HUBSPOT_BCC_ADDRESS = process.env.HUBSPOT_BCC_ADDRESS || '51580878@bcc.hubspot.com'

// Dominio de recepción de Resend Inbound (Resend → Domains → Inbound, o el
// subdominio *.resend.app que te asignen). Si está configurado, el "Reply-To"
// de cada correo saliente apunta a `deal-<dealId>@<dominio>` para que, cuando
// el cliente responda, Resend reenvíe el mensaje a nuestro webhook
// /api/webhooks/resend-inbound y ahí lo asociemos al deal correcto en HubSpot.
// Si no está seteado, el envío funciona igual que antes (sin captura de respuesta).
const RESEND_INBOUND_DOMAIN = process.env.RESEND_INBOUND_DOMAIN || null

app.post('/api/email/send', requireAuth, async (req, res) => {
  try {
    const { to, cc, subject, body, bodyHtml: bodyHtmlIn, contactId, dealId, companyId, signatureHtml, attachments, threadId, inReplyToMessageId, references } = req.body

    // Compat: el composer nuevo manda "bodyHtml" (ya formateado desde el editor
    // enriquecido); el flujo viejo mandaba "body" en texto plano con \n.
    const rawBodyHtml = bodyHtmlIn ?? (body ? body.replace(/\n/g, '<br>') : '')
    const bodyText = String(rawBodyHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    if (!to || !subject || !bodyText) {
      return res.status(400).json({ error: 'Faltan campos: to, subject, body' })
    }

    const ccList = Array.isArray(cc) ? cc.filter(Boolean) : String(cc || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
    // "to" permite más de un destinatario precargado a la vez (separados por
    // coma) — se normaliza a un array de direcciones individuales para los
    // proveedores (Resend/Graph) que lo requieren así.
    const toList = String(to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)

    // Adjuntos: [{ filename, contentType, content(base64 sin prefijo data:) }]
    const validAttachments = Array.isArray(attachments) ? attachments.filter(a => a?.filename && a?.content) : []
    const totalB64 = validAttachments.reduce((sum, a) => sum + (a.content?.length || 0), 0)
    if (totalB64 > ATTACHMENTS_MAX_TOTAL_B64) {
      return res.status(400).json({ error: 'Los adjuntos pesan demasiado en total (máx. ~2.5MB combinados)' })
    }

    const bodyHtml = rawBodyHtml + (signatureHtml ? `<br><br>${signatureHtml}` : '')
    const threadHeaders = inReplyToMessageId ? { 'In-Reply-To': inReplyToMessageId, ...(references ? { References: references } : {}) } : null
    let providerMessageId = null
    let provider = process.env.RESEND_API_KEY ? 'resend' : (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET ? 'graph' : 'smtp')

    // Si hay dominio de recepción configurado y sabemos a qué deal (o, en su
    // defecto, contacto) pertenece este correo, el Reply-To apunta a nuestro
    // buzón receptor para poder capturar la respuesta en /api/webhooks/resend-inbound.
    // El cliente sigue viendo el remitente real (fromEmail) — solo cambia a
    // dónde llega técnicamente su respuesta.
    const mailboxReplyTarget = `mailbox-${mailboxKeyForUsername(req.user.username)}`
    const replyToTarget = dealId ? `deal-${dealId}` : (contactId ? `contact-${contactId}` : mailboxReplyTarget)
    const replyToAddress = (RESEND_INBOUND_DOMAIN && replyToTarget)
      ? `${replyToTarget}@${RESEND_INBOUND_DOMAIN}`
      : null

    if (process.env.RESEND_API_KEY) {
      // ── Modo Resend API ───────────────────────────────────────────────────
      // EMAIL_USER_* por operador; si no existe, usa RESEND_FROM como fallback
      const fromEmail = getUserEmail(req.user.username) || process.env.RESEND_FROM || 'onboarding@resend.dev'
      const fromName  = req.user.name || 'BePharma'
      const resendSendR = await axios.post('https://api.resend.com/emails', {
        from: `${fromName} <${fromEmail}>`,
        to: toList,
        ...(ccList.length ? { cc: ccList } : {}),
        ...(replyToAddress ? { reply_to: [replyToAddress] } : {}),
        ...(threadHeaders ? { headers: threadHeaders } : {}),
        bcc: [HUBSPOT_BCC_ADDRESS],
        subject,
        html: bodyHtml,
        ...(validAttachments.length ? {
          attachments: validAttachments.map(a => ({ filename: a.filename, content: a.content })),
        } : {}),
      }, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
      })
      providerMessageId = resendSendR.data?.id || null
    } else if (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET) {
      // ── Modo Microsoft Graph ──────────────────────────────────────────────
      const emailUser = getUserEmail(req.user.username)
      if (!emailUser) return res.status(400).json({ error: 'no_config' })
      await sendViaGraph(emailUser, req.user.name, toList, subject, bodyHtml, validAttachments, ccList, [HUBSPOT_BCC_ADDRESS], replyToAddress)
    } else {
      // ── Fallback: SMTP ────────────────────────────────────────────────────
      const emailUser = getUserEmail(req.user.username)
      if (!emailUser) return res.status(400).json({ error: 'no_config' })
      const mailer = getUserMailer(req.user.username)
      if (!mailer) return res.status(400).json({ error: 'no_config' })
      await mailer.sendMail({
        from: `${req.user.name} <${emailUser}>`,
        to: toList.join(', '), subject,
        ...(ccList.length ? { cc: ccList.join(', ') } : {}),
        ...(replyToAddress ? { replyTo: replyToAddress } : {}),
        ...(threadHeaders ? { headers: threadHeaders } : {}),
        bcc: HUBSPOT_BCC_ADDRESS,
        text: bodyText,
        html: bodyHtml,
        ...(validAttachments.length ? {
          attachments: validAttachments.map(a => ({
            filename: a.filename,
            content: Buffer.from(a.content, 'base64'),
            contentType: a.contentType || undefined,
          })),
        } : {}),
      })
    }

    const emailUser = getUserEmail(req.user.username) || (process.env.RESEND_FROM || 'onboarding@resend.dev')

    // Subir adjuntos a la Files API de HubSpot (best-effort — si uno falla, se
    // omite y sigue con los demás; nunca bloquea el registro del email en sí).
    const uploadedFileIds = []
    const failedUploads = []
    if (validAttachments.length) {
      const results = await Promise.all(validAttachments.map(a =>
        uploadFileToHubSpot(a.filename, a.contentType, a.content)
          .then(fileId => ({ ok: true, fileId }))
          .catch(err => {
            console.warn(`[email/send] fallo al subir adjunto "${a.filename}" a HubSpot Files:`, err.response?.data?.message || err.message)
            return { ok: false, filename: a.filename }
          })
      ))
      results.forEach(r => r.ok ? uploadedFileIds.push(r.fileId) : failedUploads.push(r.filename))
    }

    // Registrar como engagement en HubSpot (API v3 — /engagements/v1 esta deprecada
    // por HubSpot y ya no asocia correctamente al deal, aunque no devuelva error)
    let hubspotLogged = false
    let hubspotLogError = null
    try {
      const assocTypeIdMap = { contacts: 198, deals: 210, companies: 186 }
      const associations = []
      if (contactId) associations.push({ to: { id: Number(contactId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeIdMap.contacts }] })
      if (dealId) associations.push({ to: { id: Number(dealId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeIdMap.deals }] })
      if (companyId) associations.push({ to: { id: Number(companyId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeIdMap.companies }] })

      // Nota de texto como respaldo — útil aunque la subida a Files haya fallado
      // (no existe una propiedad hs_email_* confirmada para CC en la API v3, así
      // que se deja como referencia de texto en vez de arriesgar un campo inválido)
      const ccNote = ccList.length ? `\n\nCC: ${ccList.join(', ')}` : ''
      const attachmentNote = (validAttachments.length
        ? `\n\n📎 Adjuntos: ${validAttachments.map(a => a.filename).join(', ')}` +
          (failedUploads.length ? ` (no se pudieron adjuntar en HubSpot: ${failedUploads.join(', ')})` : '')
        : '') + ccNote

      const emailPayload = {
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_email_direction: 'EMAIL',
          hs_email_status: 'SENT',
          hs_email_subject: subject,
          hs_email_text: bodyText + attachmentNote,
          hs_email_html: bodyHtml + (attachmentNote ? attachmentNote.replace(/\n/g, '<br>') : ''),
          hubspot_owner_id: req.user.ownerId,
          ...(uploadedFileIds.length ? { hs_attachment_ids: uploadedFileIds.join(';') } : {}),
        },
      }
      if (associations.length) emailPayload.associations = associations

      await hs.post('/crm/v3/objects/emails', emailPayload)
      hubspotLogged = true
    } catch (hsErr) {
      hubspotLogError = hsErr.response?.data?.message || hsErr.message
      console.warn('HubSpot email log error:', hsErr.response?.data || hsErr.message)
    }

    try {
      const ownerInfo = dealId ? await mailboxOwnerFromDealId(dealId) : {}
      await upsertMailboxMessage({
        id: providerMessageId ? `sent_${providerMessageId}` : `sent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        provider,
        providerMessageId,
        direction: 'outbound',
        folder: 'sent',
        subject,
        from: emailUser,
        to: toList,
        cc: ccList,
        html: bodyHtml,
        text: bodyText,
        preview: bodyText.slice(0, 260),
        createdAt: new Date().toISOString(),
        ownerId: req.user.ownerId,
        ownerUsername: req.user.username,
        ownerName: req.user.name,
        dealId,
        contactId,
        companyId,
        threadId: threadId || (!dealId && !contactId && replyToAddress ? ('mailbox:' + String(replyToAddress).toLowerCase() + ':subject:' + normalizeMailboxSubject(subject)) : undefined),
        inReplyToMessageId: inReplyToMessageId || '',
        references: references || '',
        ...ownerInfo,
      })
    } catch (mailboxErr) {
      console.warn('[mailbox] no se pudo guardar enviado:', mailboxErr.message)
    }

    res.json({
      success: true,
      hubspotLogged,
      hubspotLogError,
      attachmentsUploaded: uploadedFileIds.length,
      attachmentsFailed: failedUploads,
    })
  } catch (e) {
    const d = e.response?.data
    const msg = d?.error?.message || d?.message || (typeof d?.error === 'string' ? d.error : null) || e.message || 'Error desconocido'
    console.error('[email/send]', JSON.stringify(d || e.message))
    res.status(500).json({ error: msg })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// NOTAS — crear nota y asociar al objeto
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/hubspot/notes', requireAuth, async (req, res) => {
  try {
    const { objectType, objectId, body, noteType = 'NOTE' } = req.body
    if (!objectType || !objectId || !body) {
      return res.status(400).json({ error: 'Faltan campos: objectType, objectId, body' })
    }
    // IDs de tipo de asociación HUBSPOT_DEFINED (v3 embedded associations)
    const assocTypeIdMap = { deals: 214, contacts: 202, companies: 190 }
    const assocTypeId = assocTypeIdMap[objectType]

    const noteBody = noteType !== 'NOTE' ? `[${noteType}] ${body}` : body
    const payload = {
      properties: {
        hs_note_body: noteBody,
        hs_timestamp: new Date().toISOString(),
        hubspot_owner_id: req.user.ownerId
      }
    }
    if (assocTypeId) {
      payload.associations = [{
        to: { id: objectId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeId }]
      }]
    }
    const r = await hs.post('/crm/v3/objects/notes', payload)
    res.json(r.data)
  } catch (e) {
    console.error('[notes] error:', e.response?.data || e.message)
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// LLAMADAS — registrar llamada manual como engagement
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/hubspot/calls/log', requireAuth, async (req, res) => {
  try {
    const { objectType, objectId, outcome = 'CONNECTED', durationSeconds = 0, notes = '', phoneNumber = '' } = req.body
    const assocTypeMap = {
      deals: 'call_to_deal',
      contacts: 'call_to_contact',
      companies: 'call_to_company'
    }
    const outcomeLabel = {
      CONNECTED: 'Contesto',
      NO_ANSWER: 'No contesto',
      LEFT_VOICEMAIL: 'Buzon de voz',
      BUSY: 'Ocupado',
      WRONG_NUMBER: 'Numero equivocado',
    }[outcome] || outcome
    const seconds = Math.max(0, Number(durationSeconds || 0))
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    const durationLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
    const callBody = [
      'Registro manual de llamada',
      `Resultado: ${outcomeLabel}`,
      `Duracion: ${durationLabel}`,
      `Numero marcado: ${phoneNumber || 'N/A'}`,
      notes ? `Notas: ${notes}` : 'Notas: N/A',
    ].join('\n')
    // IDs de tipo de asociación HUBSPOT_DEFINED
    const assocTypeIdMap = { deals: 206, contacts: 194, companies: 182 }
    const assocTypeId = objectType && objectId ? assocTypeIdMap[objectType] : null

    const callPayload = {
      properties: {
        hs_call_body: callBody,
        hs_call_duration: String(seconds * 1000),
        hs_call_status: 'COMPLETED',
        hs_timestamp: new Date().toISOString(),
        hubspot_owner_id: req.user.ownerId,
        hs_call_to_number: phoneNumber,
        hs_call_title: `Llamada - ${outcomeLabel}`,
      }
    }
    if (assocTypeId) {
      callPayload.associations = [{
        to: { id: objectId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeId }]
      }]
    }
    const r = await hs.post('/crm/v3/objects/calls', callPayload)
    res.json(r.data)
  } catch (e) {
    console.error('[calls/log] error:', e.response?.data || e.message)
    res.status(e.response?.status || 500).json({
      error: readableApiError(e),
      details: e.response?.data || null,
    })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// TAREAS — crear tarea en HubSpot (supervisores pueden asignar a otros)
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/hubspot/tasks', requireAuth, async (req, res) => {
  try {
    const { subject, body = '', dueDate, priority = 'MEDIUM', assignedOwnerId, associatedObjectType, associatedObjectId } = req.body
    if (!subject || !dueDate) {
      return res.status(400).json({ error: 'Faltan campos: subject, dueDate' })
    }
    // Reglas de asignación (validadas también en el servidor, no solo en el
    // dropdown del frontend):
    //   - Operador: puede asignar la tarea a sí mismo o a un supervisor.
    //   - Supervisor: puede asignar a sí mismo o a cualquier operador.
    // Cualquier otro destino (o uno inválido) cae de vuelta al propio owner.
    const allUsers = Object.values(loadUsers())
    const supervisorIds = allUsers.filter(u => u.role === 'supervisor').map(u => u.ownerId)
    const operatorIds = allUsers.filter(u => u.role === 'operator').map(u => u.ownerId)
    const allowedTargets = req.user.role === 'supervisor'
      ? [req.user.ownerId, ...operatorIds]
      : [req.user.ownerId, ...supervisorIds]
    const ownerId = assignedOwnerId && allowedTargets.includes(assignedOwnerId)
      ? assignedOwnerId
      : req.user.ownerId
    // IDs de tipo de asociación HUBSPOT_DEFINED
    const assocTypeIdMap = { deals: 216, contacts: 204, companies: 192 }
    const assocTypeId = associatedObjectType && associatedObjectId
      ? assocTypeIdMap[associatedObjectType]
      : null

    const dueDateMs = new Date(dueDate).getTime()
    const taskPayload = {
      properties: {
        hs_task_subject: subject,
        hs_task_body: body,
        hs_timestamp: new Date(dueDate).toISOString(),
        hs_task_reminders: String(dueDateMs),   // recordatorio a la misma hora de vencimiento
        hs_task_priority: priority,
        hs_task_status: 'NOT_STARTED',
        hubspot_owner_id: ownerId
      }
    }
    if (assocTypeId) {
      taskPayload.associations = [{
        to: { id: associatedObjectId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeId }]
      }]
    }
    const r = await hs.post('/crm/v3/objects/tasks', taskPayload)
    res.json(r.data)
  } catch (e) {
    console.error('[tasks] error:', e.response?.data || e.message)
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// REPORTES BEPHARMA — metricas operativas por evento activo (solo supervisores)
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/reports/bp-summary', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })

  const OWNER_IDS = ['93615311', '93621022', '93771980', '93771979', '93771981', '73112880']
  const nowMs = Date.now()
  const minus72hMs = nowMs - 72 * 60 * 60 * 1000
  const startOfMonthMs = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()

  const safeCount = async (filters) => {
    try {
      const fg = [{ filters: [activeEventFilter(), ...filters] }]
      const r = await hs.post('/crm/v3/objects/deals/search', { filterGroups: fg, limit: 1, properties: ['dealname'] })
      return r.data.total || 0
    } catch { return 0 }
  }

  const countPerOwner = async (extraFilters) => {
    const results = await Promise.all(OWNER_IDS.map(ownerId =>
      safeCount([{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }, ...extraFilters])
    ))
    return Object.fromEntries(OWNER_IDS.map((id, i) => [id, results[i]]))
  }

  const countTasksPerOwner = async () => {
    const results = await Promise.all(OWNER_IDS.map(ownerId =>
      hs.post('/crm/v3/objects/tasks/search', {
        filterGroups: [{ filters: [
          { propertyName: 'hs_task_status', operator: 'EQ', value: 'NOT_STARTED' },
          { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }
        ]}],
        limit: 1, properties: ['hs_task_subject']
      }).then(r => [ownerId, r.data.total || 0]).catch(() => [ownerId, 0])
    ))
    return Object.fromEntries(results)
  }

  const BP_ESTADOS = ['nueva', 'en_depuracion', 'en_enriquecimiento', 'contacto_enviado', 'en_seguimiento', 'confirmada', 'no_participa']

  const [estadoCounts, callbacksPorOwner, sinActividadPorOwner, confirmadasPorOwner, participaOtroPorOwner, tareasPorOwner, nuevosEsteMes] = await Promise.all([
    Promise.all(BP_ESTADOS.map(e => safeCount([{ propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: e }]))),
    countPerOwner([
      { propertyName: 'bp_proximo_contacto', operator: 'LT', value: String(nowMs) },
      ...notTerminalFilters(),
    ]),
    countPerOwner([
      { propertyName: 'bp_ultima_actividad_operador', operator: 'LT', value: String(minus72hMs) },
      ...notTerminalFilters(),
    ]),
    countPerOwner([{ propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: 'confirmada' }]),
    countPerOwner([{ propertyName: 'bp_decision_participacion', operator: 'EQ', value: 'participa_otro_evento' }]),
    countTasksPerOwner(),
    safeCount([{ propertyName: 'createdate', operator: 'GTE', value: String(startOfMonthMs) }]),
  ])

  res.json({
    eventoActivo: ACTIVE_EVENT,
    porEstadoProspeccion: Object.fromEntries(BP_ESTADOS.map((e, i) => [e, estadoCounts[i]])),
    callbacksVencidosPorOwner: callbacksPorOwner,
    sinActividad72hPorOwner: sinActividadPorOwner,
    confirmadasPorOwner,
    participaOtroPorOwner,
    tareasPorOwner,
    nuevosEsteMes,
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// ADMIN — estado de integraciones
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/admin/integrations', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })

  const results = {}

  // HubSpot — ping con deals (scope que el app siempre tiene)
  try {
    await hs.post('/crm/v3/objects/deals/search', { filterGroups: [], limit: 1, properties: ['dealname'] })
    results.hubspot = { ok: true, label: 'Conectado' }
  } catch (e) {
    const status = e.response?.status
    const hasToken = !!process.env.HUBSPOT_ACCESS_TOKEN
    const tokenPreview = hasToken ? process.env.HUBSPOT_ACCESS_TOKEN.slice(0, 12) + '...' : 'NO CONFIGURADO'
    results.hubspot = {
      ok: false,
      label: status === 401 ? 'Token invalido (revisa HUBSPOT_ACCESS_TOKEN en Vercel)' : status === 403 ? 'Sin permisos — revisa scopes del Private App' : `Error ${status || 'red'}: ${e.message?.slice(0, 60)}`,
      debug: `token: ${tokenPreview} | status: ${status}`
    }
  }

  // Zadarma
  if (process.env.ZADARMA_API_KEY && process.env.ZADARMA_API_SECRET) {
    try {
      const data = await zadarmaRequest('/v1/info/balance/', {})
      results.zadarma = { ok: true, label: `Conectado — saldo: ${data.balance || '?'}` }
    } catch (e) {
      results.zadarma = { ok: false, label: 'Error de autenticacion' }
    }
  } else {
    results.zadarma = { ok: false, label: 'API Key no configurada' }
  }

  // Apollo
  results.apollo = process.env.APOLLO_API_KEY
    ? { ok: true, label: 'API Key configurada' }
    : { ok: false, label: 'API Key no configurada' }

  // RocketReach
  results.rocketreach = process.env.ROCKETREACH_API_KEY
    ? { ok: true, label: 'API Key configurada' }
    : { ok: false, label: 'API Key no configurada' }

  // Anthropic (Claude) — usado para el resumen IA de llamadas Zadarma
  // (webhook /api/webhooks/zadarma-call-end, solo si ANTHROPIC_API_KEY
  // esta seteada en el entorno de Vercel; es independiente de la API key
  // que usan los escenarios de Make, que va hardcodeada en cada escenario)
  results.anthropic = process.env.ANTHROPIC_API_KEY
    ? { ok: true, label: 'API Key configurada' }
    : { ok: false, label: 'API Key no configurada — el resumen IA de llamadas Zadarma no se generara' }

  // Email SMTP
  const emailUsers = ['roberto', 'yesenia', 'angel', 'gracie', 'carlos', 'sara']
    .filter(u => process.env[`EMAIL_USER_${u.toUpperCase()}`])
  results.email = {
    ok: emailUsers.length > 0,
    label: emailUsers.length > 0 ? `${emailUsers.length} usuario(s) configurados` : 'Sin cuentas SMTP configuradas',
  }

  // Webhook Zadarma token
  results.webhookToken = process.env.ZADARMA_WEBHOOK_TOKEN
    ? { ok: true, label: 'Token configurado' }
    : { ok: false, label: 'Sin token — webhook expuesto' }

  res.json(results)
})

// ──────────────────────────────────────────────────────────────────────────────
// REPORTES — actividad por operador, últimos N días (solo supervisores)
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/reports/activity', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const days = parseInt(req.query.days || '30')
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const OWNERS = {
      '93615311': 'Roberto',
      '93621022': 'Yesenia',
      '93771980': 'Angel',
      '93771979': 'Gracie',
      '93771981': 'Carlos',
      '73112880': 'Sara'
    }
    const ownerIds = Object.keys(OWNERS)

    const countEngByOwner = async (engType) => {
      const filters = [
        { propertyName: 'hs_createdate', operator: 'GTE', value: since }
      ]
      // Las llamadas "calls" incluyen miles de registros basura QUEUED generados por
      // la integracion nativa "Zadarma Calling, SMS, AI" (marcador automatico a
      // numeros al azar, nunca conecta). Esos registros nunca representan actividad
      // real del equipo, asi que se excluyen del conteo. Las llamadas reales
      // (Make.com webhook o registro manual desde la app) siempre quedan en
      // COMPLETED/NO_ANSWER, nunca QUEUED.
      if (engType === 'calls') {
        filters.push({ propertyName: 'hs_call_status', operator: 'NEQ', value: 'QUEUED' })
      }
      const results = await Promise.all(ownerIds.map(ownerId =>
        hs.post(`/crm/v3/objects/${engType}/search`, {
          filterGroups: [{
            filters: [
              { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
              ...filters,
            ]
          }],
          limit: 1, properties: ['hs_createdate']
        }).then(r => [ownerId, r.data.total || 0])
          .catch(() => [ownerId, 0])
      ))
      return Object.fromEntries(results)
    }

    // "Activo" = evento activo + estado no terminal (mismo criterio que /api/hubspot/metrics).
    // Antes filtraba por dealstage (propiedad estandar de HubSpot que esta app no usa —
    // el estado real vive en bp_estado_prospeccion), y NEQ contra un valor no poblado
    // hace que HubSpot excluya el registro, dando siempre 0.
    const countDealsByOwner = () => Promise.all(ownerIds.map(ownerId =>
      hs.post('/crm/v3/objects/deals/search', {
        filterGroups: [{
          filters: [
            { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
            activeEventFilter(),
            ...notTerminalFilters(),
          ]
        }],
        limit: 1, properties: ['dealname']
      }).then(r => [ownerId, r.data.total || 0])
        .catch(() => [ownerId, 0])
    )).then(results => Object.fromEntries(results))

    const [callsByOwner, notesByOwner, dealsByOwner] = await Promise.all([
      countEngByOwner('calls'),
      countEngByOwner('notes'),
      countDealsByOwner()
    ])

    const owners = ownerIds.map(ownerId => ({
      ownerId,
      name: OWNERS[ownerId],
      calls: callsByOwner[ownerId] || 0,
      notes: notesByOwner[ownerId] || 0,
      activeDeals: dealsByOwner[ownerId] || 0
    }))

    res.json({ owners, period: days })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// REPORTES — export Excel del reporte de Actividad (usa los datos ya
// calculados por el frontend, mismo criterio que /api/reports/activity, para
// no repetir todas las llamadas a HubSpot server-side)
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/reports/activity/export', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const { owners = [], byStage = [], byMonth = [], period, filtroResumen } = req.body

    const sections = [
      {
        heading: 'Resumen por operador',
        columns: [
          { header: 'Operador',       key: 'name',        width: 18 },
          { header: 'Llamadas',       key: 'calls',       width: 12 },
          { header: 'Notas',          key: 'notes',       width: 12 },
          { header: 'Eventos activos', key: 'activeDeals', width: 16 },
        ],
        rows: owners.map(o => ({ name: o.name, calls: o.calls, notes: o.notes, activeDeals: o.activeDeals })),
      },
    ]

    if (byStage.length) {
      sections.push({
        heading: 'Eventos por etapa',
        columns: [
          { header: 'Etapa', key: 'stage', width: 22 },
          { header: 'Total', key: 'total', width: 12 },
        ],
        rows: byStage.map(s => ({ stage: s.stage ?? s.label ?? s.name, total: s.total ?? s.count ?? s.value })),
      })
    }

    if (byMonth.length) {
      sections.push({
        heading: 'Eventos creados por mes',
        columns: [
          { header: 'Mes',   key: 'month', width: 16 },
          { header: 'Total', key: 'total', width: 12 },
        ],
        rows: byMonth.map(m => ({ month: m.month ?? m.label ?? m.name, total: m.total ?? m.count ?? m.value })),
      })
    }

    const workbook = await buildMultiSectionWorkbook({
      sheetName: 'Actividad',
      title: 'BePharma CRM — Reporte de Actividad',
      eventoActivo: ACTIVE_EVENT,
      filtroResumen: filtroResumen || (period ? `Últimos ${period} días` : ''),
      generadoPor: req.user?.username,
      sections,
    })
    const buffer = await workbookToBuffer(workbook)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="BePharma_Actividad_${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (e) {
    console.error('[reports/activity/export] Error:', e.response?.data || e.message)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// REPORTES — export Excel del reporte BePharma (resumen global de
// prospección) — igual que arriba, usa los datos ya calculados por el
// frontend (respuesta de /api/reports/bp-summary) en vez de recalcular.
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/reports/bp-summary/export', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const { bpData = {}, filtroResumen } = req.body
    const {
      porEstadoProspeccion = {},
      callbacksVencidosPorOwner = {},
      sinActividad72hPorOwner = {},
      confirmadasPorOwner = {},
      participaOtroPorOwner = {},
      tareasPorOwner = {},
      nuevosEsteMes = 0,
    } = bpData

    const BP_ESTADO_LABELS = {
      nueva: 'Nueva', en_depuracion: 'En Depuración', en_enriquecimiento: 'En Enriquecimiento',
      contacto_enviado: 'Por Contactar', en_seguimiento: 'En Seguimiento',
      confirmada: 'Confirmada', no_participa: 'No Participa',
    }

    const ownerTable = (perOwner) => Object.entries(perOwner).map(([ownerId, total]) => ({
      name: DEAL_OWNER_NAMES_XLS[ownerId] || ownerId, total,
    }))

    const sections = [
      {
        heading: 'Resumen global',
        columns: [
          { header: 'Métrica', key: 'metric', width: 30 },
          { header: 'Valor',   key: 'value',  width: 14 },
        ],
        rows: [{ metric: 'Nuevos este mes', value: nuevosEsteMes }],
      },
      {
        heading: 'Distribución por estado de prospección',
        columns: [
          { header: 'Estado', key: 'estado', width: 22 },
          { header: 'Total',  key: 'total',  width: 12 },
        ],
        rows: Object.entries(porEstadoProspeccion).map(([estado, total]) => ({
          estado: BP_ESTADO_LABELS[estado] || estado, total,
        })),
      },
      {
        heading: 'Callbacks vencidos por operador',
        columns: [
          { header: 'Operador', key: 'name', width: 18 },
          { header: 'Total',    key: 'total', width: 12 },
        ],
        rows: ownerTable(callbacksVencidosPorOwner),
      },
      {
        heading: 'Sin actividad 72h por operador',
        columns: [
          { header: 'Operador', key: 'name', width: 18 },
          { header: 'Total',    key: 'total', width: 12 },
        ],
        rows: ownerTable(sinActividad72hPorOwner),
      },
      {
        heading: 'Confirmadas por operador',
        columns: [
          { header: 'Operador', key: 'name', width: 18 },
          { header: 'Total',    key: 'total', width: 12 },
        ],
        rows: ownerTable(confirmadasPorOwner),
      },
      {
        heading: 'Participa en otro evento por operador',
        columns: [
          { header: 'Operador', key: 'name', width: 18 },
          { header: 'Total',    key: 'total', width: 12 },
        ],
        rows: ownerTable(participaOtroPorOwner),
      },
      {
        heading: 'Tareas pendientes por operador',
        columns: [
          { header: 'Operador', key: 'name', width: 18 },
          { header: 'Total',    key: 'total', width: 12 },
        ],
        rows: ownerTable(tareasPorOwner),
      },
    ]

    const workbook = await buildMultiSectionWorkbook({
      sheetName: 'BePharma',
      title: 'BePharma CRM — Reporte BePharma',
      eventoActivo: ACTIVE_EVENT,
      filtroResumen,
      generadoPor: req.user?.username,
      sections,
    })
    const buffer = await workbookToBuffer(workbook)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="BePharma_Resumen_${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (e) {
    console.error('[reports/bp-summary/export] Error:', e.response?.data || e.message)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// REPORTES — historial de llamadas de un operador
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/reports/calls', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const { ownerId, days = 30 } = req.query
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString()
    // Excluye llamadas QUEUED (basura del marcador automatico de la integracion
    // "Zadarma Calling, SMS, AI") — ver nota en /api/reports/activity
    const filters = [
      { propertyName: 'hs_createdate', operator: 'GTE', value: since },
      { propertyName: 'hs_call_status', operator: 'NEQ', value: 'QUEUED' },
    ]
    if (ownerId) filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId })
    const r = await hs.post('/crm/v3/objects/calls/search', {
      filterGroups: [{ filters }],
      properties: ['hs_call_body', 'hs_call_duration', 'hs_call_status', 'hs_call_recording_url', 'hs_timestamp', 'hs_call_title', 'hubspot_owner_id'],
      sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
      limit: 50
    })
    res.json({ results: r.data.results || [], total: r.data.total || 0 })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// REPORTES — historial de notas de un operador
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/reports/notes', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const { ownerId, days = 30 } = req.query
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString()
    const filters = [{ propertyName: 'hs_createdate', operator: 'GTE', value: since }]
    if (ownerId) filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId })
    const r = await hs.post('/crm/v3/objects/notes/search', {
      filterGroups: [{ filters }],
      properties: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'],
      sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
      limit: 50
    })
    res.json({ results: r.data.results || [], total: r.data.total || 0 })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// BULK STAGE UPDATE — etapa de múltiples empresas a la vez
// ──────────────────────────────────────────────────────────────────────────────
app.patch('/api/hubspot/companies/bulk-stage', requireAuth, async (req, res) => {
  try {
    const { ids, stage } = req.body
    if (!ids?.length || !stage) return res.status(400).json({ error: 'Faltan ids o stage' })
    const results = await Promise.allSettled(
      ids.map(id => hs.patch(`/crm/v3/objects/companies/${id}`, { properties: { bp_etapa_empresa: stage } }))
    )
    res.json({
      succeeded: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      total: ids.length
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// WEBHOOK ZADARMA — Make.com → BePharma (sin requireAuth)
// Payload Make.com "Watch call end": caller_id, called_did, duration, status,
//   sip, call_id_with_rec, pbx_call_id, record, call_start, call_end, internal
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/webhooks/zadarma-call-end', requireWebhookToken, async (req, res) => {
  try {
    const {
      sip,              // extensión SIP del agente (ej: "100")
      caller_id,        // número que inicia la llamada
      called_did,       // número destino
      duration,         // segundos
      status,           // answered / not_answered / busy / cancel
      record,           // URL grabación (si está habilitado)
      call_id_with_rec, // ID único de llamada
      pbx_call_id,
      call_start,
      call_end,
      internal,         // "1" = llamada interna
      disposition,      // campo adicional opcional
    } = req.body

    // Saltar llamadas internas
    if (internal === '1' || internal === 1) {
      return res.json({ success: true, skipped: 'llamada interna' })
    }

    // ── Mapear extensión SIP → HubSpot owner ID ─────────────────────────────
    let hubspotOwnerId = null
    try {
      const usersData = loadUsers()
      const match = Object.values(usersData).find(u => u.sipExtension && u.sipExtension.toString() === (sip || '').toString())
      if (match) hubspotOwnerId = match.ownerId
    } catch (e) { /* ignore */ }

    // ── Buscar contacto en HubSpot por número de teléfono ───────────────────
    // En llamadas salientes: called_did es el número del prospecto
    const prospectPhone = (internal === '0' || !internal) ? (called_did || caller_id) : null
    let contactId = null
    let dealId = null
    if (prospectPhone) {
      try {
        const searchR = await hs.post('/crm/v3/objects/contacts/search', {
          filterGroups: [{
            filters: [{
              propertyName: 'phone',
              operator: 'CONTAINS_TOKEN',
              value: prospectPhone.replace(/\D/g, '').slice(-8) // últimos 8 dígitos
            }]
          }],
          properties: ['firstname', 'lastname', 'phone'],
          limit: 1
        })
        if (searchR.data.results.length > 0) {
          contactId = searchR.data.results[0].id
          // Intentar encontrar negocio asociado al contacto
          try {
            const assocR = await hs.get(`/crm/v3/objects/contacts/${contactId}/associations/deals`)
            if (assocR.data.results.length > 0) dealId = assocR.data.results[0].id
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.warn('[webhook] Phone search error:', e.message)
      }
    }

    // ── Construir texto del engagement ──────────────────────────────────────
    const durMin = Math.floor(Number(duration || 0) / 60)
    const durSec = Number(duration || 0) % 60
    const durStr = durMin > 0 ? `${durMin}m ${durSec}s` : `${durSec}s`
    const statusLabel = {
      answered: '✅ Contestada', not_answered: '❌ No contestada',
      busy: '🔴 Ocupado', cancel: '⚪ Cancelada'
    }[status] || status || 'N/A'

    let callBody = `📞 Llamada Zadarma — ${statusLabel}\n` +
      `Extensión: ${sip || 'N/A'}  |  Destino: ${called_did || caller_id || 'N/A'}\n` +
      `Duración: ${durStr}`

    if (record) callBody += `\n🔊 Grabación: ${record}`
    if (call_id_with_rec) callBody += `\nID: ${call_id_with_rec}`
    if (disposition) callBody += `\nResultado: ${disposition}`

    // ── Generar resumen AI si la llamada fue contestada y duró > 30s ────────
    if (process.env.ANTHROPIC_API_KEY && status === 'answered' && Number(duration) > 30) {
      try {
        const claudeRes = await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: 'Eres un asistente de CRM farmacéutico. Genera un resumen breve en español de una llamada de ventas para el timeline del CRM. Máximo 3 oraciones, sé conciso y profesional.',
          messages: [{
            role: 'user',
            content: `Llamada de ventas farmacéutica. Duración: ${durStr}. Estado: ${statusLabel}. Extensión SIP: ${sip}. Número contactado: ${called_did || caller_id}.${disposition ? ` Resultado: ${disposition}.` : ''}`
          }]
        }, {
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          }
        })
        const aiSummary = claudeRes.data?.content?.[0]?.text
        if (aiSummary) callBody += `\n\n🤖 Resumen IA: ${aiSummary}`
      } catch (claudeErr) {
        console.warn('[webhook] Claude error:', claudeErr.message)
      }
    }

    // ── Crear engagement de tipo CALL en HubSpot ────────────────────────────
    const callProps = {
      hs_call_body: callBody,
      hs_call_duration: String(Number(duration || 0) * 1000), // ms
      hs_call_status: status === 'answered' ? 'COMPLETED' : 'NO_ANSWER',
      hs_call_direction: 'OUTBOUND',
      hs_timestamp: call_start ? new Date(call_start).toISOString() : new Date().toISOString(),
      hs_call_title: `Llamada Zadarma — ${statusLabel}`,
    }
    if (hubspotOwnerId) callProps.hubspot_owner_id = hubspotOwnerId
    if (record) callProps.hs_call_recording_url = record

    const callR = await hs.post('/crm/v3/objects/calls', { properties: callProps })
    const callEngId = callR.data.id

    // ── Asociar el engagement al contacto y negocio encontrados ────────────
    if (contactId) {
      try { await hs.put(`/crm/v3/objects/calls/${callEngId}/associations/contacts/${contactId}/call_to_contact`) } catch {}
    }
    if (dealId) {
      try { await hs.put(`/crm/v3/objects/calls/${callEngId}/associations/deals/${dealId}/call_to_deal`) } catch {}
    }

    console.log(`[webhook/zadarma] Call logged: ${callEngId} | sip=${sip} | status=${status} | duration=${duration}s | contact=${contactId || 'none'}`)
    res.json({ success: true, callEngId, contactId, dealId })
  } catch (e) {
    console.error('[webhook/zadarma] error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Verificación de firma Svix (esquema que usa Resend para firmar webhooks) ──
// HMAC-SHA256 sobre "{svix-id}.{svix-timestamp}.{rawBody}" con el secreto
// (base64, sin el prefijo "whsec_"). El header svix-signature puede traer
// varias firmas separadas por espacio, cada una "v1,<base64>" — basta con que
// una coincida. Requiere el rawBody exacto (ver "verify" en express.json()).
// Devuelve { ok, reason } en vez de solo boolean para poder diagnosticar en los
// logs de Vercel sin necesidad de otra vuelta completa de correo real→respuesta.
function verifySvixSignature(rawBody, headers, secret) {
  if (!secret) return { ok: false, reason: 'sin RESEND_WEBHOOK_SECRET configurado' }
  if (!rawBody || !rawBody.length) return { ok: false, reason: 'rawBody vacío (revisar verify() de express.json)' }

  const svixId = headers['svix-id']
  const svixTimestamp = headers['svix-timestamp']
  const svixSignature = headers['svix-signature']
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: `faltan headers svix (id=${!!svixId}, timestamp=${!!svixTimestamp}, signature=${!!svixSignature})` }
  }

  // Rechaza timestamps de más de 5 min (mitiga replay attacks)
  const tsSeconds = Number(svixTimestamp)
  if (!Number.isFinite(tsSeconds)) return { ok: false, reason: 'svix-timestamp no es numérico' }
  const skewSec = Math.abs(Date.now() / 1000 - tsSeconds)
  if (skewSec > 300) return { ok: false, reason: `timestamp fuera de rango (skew=${Math.round(skewSec)}s)` }

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signedContent = `${svixId}.${svixTimestamp}.${bodyStr}`
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64')

  const matched = svixSignature.split(' ').some(part => {
    const sig = part.split(',')[1]
    if (!sig) return false
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'base64'), Buffer.from(expected, 'base64'))
    } catch {
      return false // longitudes distintas → nunca coincide, pero no debe tirar la request
    }
  })

  if (!matched) {
    return {
      ok: false,
      reason: `firma no coincide (secretBytes.length=${secretBytes.length}, esperado[0:8]=${expected.slice(0, 8)}, recibido="${svixSignature.slice(0, 20)}...")`
    }
  }
  return { ok: true, reason: null }
}

// ──────────────────────────────────────────────────────────────────────────────
// WEBHOOK RESEND INBOUND — captura respuestas de clientes → HubSpot (sin requireAuth)
// Requiere en Vercel: RESEND_WEBHOOK_SECRET (Resend → Webhooks → tu endpoint →
// Signing secret) y RESEND_INBOUND_DOMAIN (Resend → Domains → Inbound, o el
// *.resend.app que te asignen). El Reply-To de cada correo saliente (ver
// /api/email/send) apunta a deal-<id>@RESEND_INBOUND_DOMAIN o
// contact-<id>@RESEND_INBOUND_DOMAIN, así que la respuesta llega aquí con el
// deal/contacto ya identificado en el "to" — sin necesidad de adivinar el hilo.
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/webhooks/resend-inbound', async (req, res) => {
  try {
    const verification = verifySvixSignature(req.rawBody, req.headers, process.env.RESEND_WEBHOOK_SECRET)
    if (!verification.ok) {
      // Log detallado (sin exponer el secreto) para diagnosticar en Vercel sin
      // depender de otra prueba real de correo→respuesta.
      console.warn(`[webhook/resend-inbound] firma inválida — rechazado. Motivo: ${verification.reason}`)
      return res.status(401).json({ error: 'invalid_signature' })
    }

    const event = req.body
    if (event?.type !== 'email.received') {
      return res.json({ ok: true, skipped: 'evento no es email.received' })
    }

    const { email_id: emailId, from: fromAddress, to: toAddresses, subject } = event.data || {}

    // El "to" trae la dirección deal-<id>@... / contact-<id>@... que armamos
    // al enviar (ver replyToAddress en /api/email/send)
    const toMatch = (toAddresses || []).map(String).find(addr => /^(deal|contact)-\d+@|^mailbox-[^@]+@/i.test(addr))
    const parsed = toMatch ? toMatch.match(/^(?:(deal|contact)-(\d+)|mailbox-([^@]+))@/i) : null
    if (!parsed) {
      console.warn(`[webhook/resend-inbound] no se identifico destino CRM en "to": ${JSON.stringify(toAddresses)}`)
      return res.json({ ok: true, skipped: 'sin destino CRM identificado en to' })
    }
    const targetType = parsed[1] || (parsed[3] ? 'mailbox' : null)
    const targetId = parsed[2]
    const mailboxKey = parsed[3]
    const mailboxUser = mailboxKey ? findUserByMailboxKey(mailboxKey) : null
    const dealId = targetType === 'deal' ? targetId : null
    let contactId = targetType === 'contact' ? targetId : null

    // El webhook solo trae metadata — el cuerpo hay que pedirlo aparte
    let bodyText = ''
    let bodyHtml = ''
    try {
      const detail = await fetchReceivedEmailBody(emailId)
      bodyText = detail.text || ''
      bodyHtml = detail.html || ''
    } catch (detailErr) {
      console.warn('[webhook/resend-inbound] fallo al pedir el cuerpo del correo:', detailErr.response?.data || detailErr.message)
    }

    // Si el reply-to solo traía dealId, intentar resolver también el contacto
    // por el email real del remitente (mejora la asociación, no es obligatorio)
    if (!contactId && fromAddress) {
      try {
        const searchR = await hs.post('/crm/v3/objects/contacts/search', {
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: fromAddress }] }],
          properties: ['email'],
          limit: 1,
        })
        if (searchR.data.results?.length) contactId = searchR.data.results[0].id
      } catch (e) {
        console.warn('[webhook/resend-inbound] fallo buscando contacto por email:', e.message)
      }
    }

    if (!dealId && !contactId && !mailboxUser) {
      console.warn(`[webhook/resend-inbound] respuesta de ${fromAddress} sin deal, contacto ni mailbox asociable - no se loguea`)
      return res.json({ ok: true, skipped: 'sin deal/contact/mailbox asociable' })
    }

    // Best-effort: resolver el email real del operador dueño del deal para que
    // el "to" mostrado en HubSpot sea legible (yesenia@bepharma.org) en vez de
    // la dirección técnica de recepción (deal-<id>@...resend.app)
    let toDisplayEmail = toMatch || ''
    if (mailboxUser) {
      toDisplayEmail = getUserEmail(mailboxUser[0]) || toDisplayEmail
    }
    if (dealId) {
      try {
        const dealR = await hs.get(`/crm/v3/objects/deals/${dealId}`, { params: { properties: 'hubspot_owner_id' } })
        const ownerId = dealR.data?.properties?.hubspot_owner_id
        if (ownerId) {
          const ownerR = await hs.get(`/crm/v3/owners/${ownerId}`)
          if (ownerR.data?.email) toDisplayEmail = ownerR.data.email
        }
      } catch (e) {
        console.warn('[webhook/resend-inbound] fallo resolviendo email del owner del deal:', e.message)
      }
    }

    // Mismos IDs de tipo de asociación HUBSPOT_DEFINED que ya usa /api/email/send
    const assocTypeIdMap = { contacts: 198, deals: 210 }
    const associations = []
    if (contactId) associations.push({ to: { id: Number(contactId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeIdMap.contacts }] })
    if (dealId) associations.push({ to: { id: Number(dealId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeIdMap.deals }] })

    // hs_email_from_email / hs_email_to_email NO se pueden setear directo —
    // HubSpot las deriva de hs_email_headers (JSON string con from/to/cc/bcc).
    // Ver: community.hubspot.com "Problem to set property hs_email_headers"
    const emailHeaders = {
      from: { email: fromAddress || '' },
      to: [{ email: toDisplayEmail || '' }],
      cc: [],
      bcc: [],
    }

    const emailPayload = {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_email_direction: 'INCOMING_EMAIL',
        // hs_email_status solo admite [BOUNCED, FAILED, SCHEDULED, SENDING,
        // SENT, DRAFT] — no existe "RECEIVED". Para un entrante, SENT es la
        // opción correcta (el cliente sí lo envió); hs_email_direction ya
        // indica que es entrante.
        hs_email_status: 'SENT',
        hs_email_subject: subject || '(sin asunto)',
        hs_email_text: bodyText,
        hs_email_html: bodyHtml,
        hs_email_headers: JSON.stringify(emailHeaders),
      },
      ...(associations.length ? { associations } : {}),
    }

    const createR = await hs.post('/crm/v3/objects/emails', emailPayload)

    try {
      const ownerInfo = dealId ? await mailboxOwnerFromDealId(dealId) : (mailboxUser ? { ownerUsername: mailboxUser[0], ownerName: mailboxUser[1]?.name || '', ownerId: mailboxUser[1]?.ownerId || '' } : {})
      await upsertMailboxMessage({
        id: `resend_in_${emailId}`,
        resendEmailId: emailId,
        provider: 'resend',
        direction: 'inbound',
        folder: 'inbox',
        subject: subject || '(sin asunto)',
        from: fromAddress || '',
        to: toAddresses || [],
        html: bodyHtml,
        text: bodyText,
        preview: (bodyText || stripEmailHtml(bodyHtml)).slice(0, 260),
        messageId: event.data?.message_id || '',
        createdAt: event.data?.created_at || new Date().toISOString(),
        dealId,
        contactId,
        threadId: dealId ? `deal:${dealId}:subject:${normalizeMailboxSubject(subject || '(sin asunto)')}` : undefined,
        hubspotEmailId: createR.data.id,
        ...ownerInfo,
      })
      console.log('[mailbox] respuesta entrante guardada')
    } catch (mailboxErr) {
      console.warn('[mailbox] no se pudo guardar entrante:', mailboxErr.message)
    }

    console.log(`[webhook/resend-inbound] respuesta logueada: ${createR.data.id} | from=${fromAddress} | deal=${dealId || '-'} | contact=${contactId || '-'}`)
    res.json({ ok: true, engagementId: createR.data.id, dealId, contactId })
  } catch (e) {
    console.error('[webhook/resend-inbound] error:', e.response?.data || e.message)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// NOTIFICACIONES — tareas pendientes del usuario actual (últimos 7 días)
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/hubspot/notifications', requireAuth, async (req, res) => {
  try {
    const r = await hs.post('/crm/v3/objects/tasks/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'hs_task_status', operator: 'EQ', value: 'NOT_STARTED' },
          { propertyName: 'hubspot_owner_id', operator: 'EQ', value: req.user.ownerId }
        ]
      }],
      sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
      limit: 20,
      properties: ['hs_task_subject', 'hs_task_body', 'hs_timestamp', 'hs_task_priority', 'hubspot_owner_id']
    })
    res.json({ count: r.data.total || 0, results: r.data.results || [] })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Error handler global — debe registrarse después de todas las rutas
app.use(errorHandler)

// ──────────────────────────────────────────────────────────────────────────────
// En desarrollo escucha en el puerto; en Vercel se exporta como función serverless
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`BePharma API server → http://localhost:${PORT}`))
}
module.exports = app







