require('dotenv').config()
const env = require('./config/env')   // valida vars criticas; falla si faltan

const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const axios = require('axios')
const crypto = require('crypto')
const nodemailer = require('nodemailer')
const { login, requireAuth, applyOwnerFilter } = require('./auth')
const { requireWebhookToken } = require('./middleware/webhookAuth')
const { errorHandler } = require('./middleware/errorHandler')

const app = express()

// ── Seguridad base ────────────────────────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: env.APP_ORIGIN,
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))

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

const PORT = env.PORT

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
  activeEventFilter,
  notTerminalFilters,
} = require('./config/hubspotProperties')

// Deals – búsqueda con filtros BePharma
app.post('/api/hubspot/deals/search', requireAuth, async (req, res) => {
  try {
    const { filters = [], sorts = [], limit = 50, after, properties } = req.body
    const filterGroups = applyOwnerFilter(req, filters.length ? [{ filters }] : [])
    const r = await hs.post('/crm/v3/objects/deals/search', {
      filterGroups,
      sorts,
      limit,
      after,
      properties: properties || DEAL_PROPERTIES,
    })
    res.json(r.data)
  } catch (e) {
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
          properties: ['name', 'domain'],
        })
        const byId = Object.fromEntries((cr.data.results || []).map(c => [c.id, c]))
        deal.associations.companies.results = uniqueCompanyIds.map(id => byId[id]).filter(Boolean)
      } catch {
        deal.associations.companies.results = uniqueCompanyIds.map(id => ({ id }))
      }
    }

    res.json(deal)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// Empresas – búsqueda (sin filtro de owner: las empresas son registros compartidos)
app.post('/api/hubspot/companies/search', requireAuth, async (req, res) => {
  try {
    const { filters = [], sorts = [], limit = 50, after, properties: customProps } = req.body
    const filterGroups = filters.length ? [{ filters }] : []
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

// Búsqueda rápida de empresas por nombre (DEBE ir antes de /:id)
app.get('/api/hubspot/companies/quick-search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ results: [] })
    const r = await hs.post('/crm/v3/objects/companies/search', {
      filterGroups: [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: q }] }],
      properties: ['name', 'domain', 'city'],
      limit: 10
    })
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
        ? Promise.all(dealIds.slice(0, 10).map(did =>
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
    const { filters = [], sorts = [], limit = 50, after } = req.body
    const filterGroups = applyOwnerFilter(req, filters.length ? [{ filters }] : [])
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
          properties: ['name', 'domain'],
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
    notes:    ['hs_note_body', 'hs_createdate'],
    calls:    ['hs_call_body', 'hs_call_duration', 'hs_createdate', 'hs_call_status', 'hs_call_direction'],
    meetings: ['hs_meeting_title', 'hs_meeting_body', 'hs_meeting_start_time', 'hs_createdate'],
    emails:   ['hs_email_subject', 'hs_email_text', 'hs_createdate'],
    tasks:    ['hs_task_subject', 'hs_task_body', 'hs_createdate', 'hs_task_status']
  }
  const typeLabel = { notes: 'NOTE', calls: 'CALL', meetings: 'MEETING', emails: 'EMAIL', tasks: 'TASK' }
  const allItems = []

  await Promise.all(Object.keys(propMap).map(async (engType) => {
    try {
      const assocR = await hs.get(`/crm/v3/objects/${objectType}/${objectId}/associations/${engType}`)
      const ids = (assocR.data.results || []).map(r => r.id).slice(0, 15)
      if (!ids.length) return
      const details = await Promise.all(ids.map(id =>
        hs.get(`/crm/v3/objects/${engType}/${id}`, {
          params: { properties: propMap[engType].join(',') }
        }).catch(() => null)
      ))
      details.filter(Boolean).forEach(d => {
        const p = d.data.properties
        allItems.push({
          id: d.data.id,
          type: typeLabel[engType],
          createdAt: p.hs_createdate || p.hs_meeting_start_time || null,
          body: p.hs_note_body || p.hs_call_body || p.hs_meeting_body || p.hs_email_text || p.hs_task_body || '',
          title: p.hs_meeting_title || p.hs_email_subject || p.hs_task_subject || '',
          durationMs: p.hs_call_duration || null
        })
      })
    } catch { /* skip */ }
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
      const filterGroups = applyOwnerFilter(req, [{ filters: [activeEventFilter()] }])
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
    const r = await hs.post('/crm/v3/objects/deals', { properties: props })
    const dealId = r.data.id
    // Si viene _companyId, crear la asociación deal → empresa (API v4, asociación por defecto)
    if (_companyId && dealId) {
      try {
        await hs.put(`/crm/v4/objects/deals/${dealId}/associations/default/companies/${_companyId}`)
      } catch (assocErr) {
        console.warn('[deals] Error asociando empresa:', assocErr.response?.data || assocErr.message)
      }
    }
    res.json(r.data)
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
    const r = await hs.patch(`/crm/v3/objects/deals/${req.params.id}`, { properties: req.body })
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
app.post('/api/hubspot/companies', requireAuth, async (req, res) => {
  try {
    const r = await hs.post('/crm/v3/objects/companies', { properties: req.body })
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

app.patch('/api/hubspot/companies/:id', requireAuth, async (req, res) => {
  try {
    const r = await hs.patch(`/crm/v3/objects/companies/${req.params.id}`, { properties: req.body })
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
    const r = await hs.patch(`/crm/v3/objects/contacts/${req.params.id}`, { properties: req.body })
    res.json(r.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

app.delete('/api/hubspot/contacts/:id', requireAuth, async (req, res) => {
  try {
    await hs.delete(`/crm/v3/objects/contacts/${req.params.id}`)
    res.json({ success: true })
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.response?.data || e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// CHARTS — datos para gráficas del dashboard
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/hubspot/charts', requireAuth, async (req, res) => {
  const fg = (baseFilters) => applyOwnerFilter(req, [{ filters: [activeEventFilter(), ...baseFilters] }])
  const safe = async (filters) => {
    try {
      const r = await hs.post('/crm/v3/objects/deals/search', {
        filterGroups: fg(filters), limit: 1, properties: ['dealname'],
      })
      return r.data.total || 0
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
  const stageCounts = []
  for (const s of PIPELINE_STAGES) {
    stageCounts.push(await safe([{ propertyName: 'bp_estado_prospeccion', operator: 'EQ', value: s.key }]))
    await delay(260)
  }

  const monthlyCounts = []
  for (const m of months) {
    monthlyCounts.push(await safe([
      { propertyName: 'createdate', operator: 'GTE', value: String(m.startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(m.endMs) },
    ]))
    await delay(260)
  }

  res.json({
    byStage: PIPELINE_STAGES.map((s, i) => ({ ...s, count: stageCounts[i] })),
    byMonth: months.map((m, i) => ({ label: m.label, count: monthlyCounts[i] })),
  })
})

// Admin – lista usuarios con config Zadarma
app.get('/api/admin/users', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  const users = require('./users.json')
  const safe = Object.entries(users).map(([username, u]) => ({
    username,
    name: u.name,
    role: u.role,
    ownerId: u.ownerId,
    sipExtension: u.sipExtension || '',
    bp_zona: u.bp_zona || '',
    emailUser: u.emailUser || ''   // no exponemos emailPass
  }))
  res.json(safe)
})

// Admin – actualizar extensión SIP de un usuario
app.patch('/api/admin/users/:username/sip', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const fs = require('fs')
    const path = require('path')
    const usersPath = path.join(__dirname, 'users.json')
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
    if (!users[req.params.username]) return res.status(404).json({ error: 'Usuario no encontrado' })
    users[req.params.username].sipExtension = req.body.sipExtension || ''
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Admin – actualizar zona BePharma de un usuario
app.patch('/api/admin/users/:username/zona', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const fs = require('fs')
    const path = require('path')
    const usersPath = path.join(__dirname, 'users.json')
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
    if (!users[req.params.username]) return res.status(404).json({ error: 'Usuario no encontrado' })
    users[req.params.username].bp_zona = req.body.bp_zona || ''
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})


// Crear contacto en HubSpot y opcionalmente asociarlo a una empresa
app.post('/api/hubspot/contacts', requireAuth, async (req, res) => {
  try {
    const { _companyId, ...properties } = req.body
    const r = await hs.post('/crm/v3/objects/contacts', { properties })
    const contactId = r.data.id
    // Si viene un company ID, crear la asociación
    if (_companyId && contactId) {
      try {
        await hs.put(`/crm/v3/objects/contacts/${contactId}/associations/companies/${_companyId}/contact_to_company`)
      } catch (assocErr) {
        console.warn('[contacts] Error asociando empresa:', assocErr.message)
      }
    }
    res.json(r.data)
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

    const fg = (baseFilters) => applyOwnerFilter(req, [{ filters: [activeEventFilter(), ...baseFilters] }])

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
    const BP_ESTADOS = ['nueva', 'en_depuracion', 'en_enriquecimiento', 'contacto_enviado', 'en_seguimiento', 'confirmada', 'no_participa']
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
    auth: { user: smtpAuthUser, pass: emailPass },
  })
}

function getUserEmail(username) {
  return process.env[`EMAIL_USER_${username.toUpperCase()}`] || null
}

// Verificar config SMTP del usuario autenticado
app.get('/api/email/verify', requireAuth, async (req, res) => {
  const emailUser = getUserEmail(req.user.username)
  if (!emailUser) return res.json({ ok: false, error: 'no_config' })
  const mailer = getUserMailer(req.user.username)
  try {
    await mailer.verify()
    res.json({ ok: true, user: emailUser })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// Admin: lista de usuarios con estado de email configurado
app.get('/api/admin/email-status', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  const users = require('./users.json')
  const status = Object.keys(users).map(username => ({
    username,
    name: users[username].name,
    emailUser: getUserEmail(username) || '',
    configured: !!getUserEmail(username)
  }))
  res.json(status)
})

// Enviar email + registrar en HubSpot como engagement
app.post('/api/email/send', requireAuth, async (req, res) => {
  try {
    const { to, subject, body, contactId, dealId, companyId } = req.body
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Faltan campos: to, subject, body' })
    }

    const mailer = getUserMailer(req.user.username)
    if (!mailer) {
      return res.status(400).json({ error: 'no_config' })
    }

    const emailUser = getUserEmail(req.user.username)

    // 1. Enviar email vía SMTP
    const info = await mailer.sendMail({
      from: `${req.user.name} <${emailUser}>`,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>')
    })

    // 2. Registrar como engagement en HubSpot
    try {
      await hs.post('/engagements/v1/engagements', {
        engagement: { active: true, type: 'EMAIL', timestamp: Date.now() },
        associations: {
          contactIds: contactId ? [Number(contactId)] : [],
          dealIds: dealId ? [Number(dealId)] : [],
          companyIds: companyId ? [Number(companyId)] : []
        },
        metadata: {
          from: { email: emailUser, firstName: req.user.name },
          to: [{ email: to }],
          subject, text: body,
          html: body.replace(/\n/g, '<br>'),
          status: 'SENT'
        }
      })
    } catch (hsErr) {
      console.warn('HubSpot email log error:', hsErr.response?.data || hsErr.message)
    }

    res.json({ success: true, messageId: info.messageId })
  } catch (e) {
    res.status(500).json({ error: e.message })
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
    const assocTypeMap = {
      deals: 'note_to_deal',
      contacts: 'note_to_contact',
      companies: 'note_to_company'
    }
    const noteBody = noteType !== 'NOTE' ? `[${noteType}] ${body}` : body
    const r = await hs.post('/crm/v3/objects/notes', {
      properties: {
        hs_note_body: noteBody,
        hs_timestamp: new Date().toISOString(),
        hubspot_owner_id: req.user.ownerId
      }
    })
    const noteId = r.data.id
    try {
      await hs.put(`/crm/v3/objects/notes/${noteId}/associations/${objectType}/${objectId}/${assocTypeMap[objectType] || 'note_to_deal'}`)
    } catch (assocErr) {
      console.warn('[notes] association error:', assocErr.message)
    }
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
    const r = await hs.post('/crm/v3/objects/calls', {
      properties: {
        hs_call_body: callBody,
        hs_call_duration: String(seconds * 1000),
        hs_call_status: 'COMPLETED',
        hs_timestamp: new Date().toISOString(),
        hubspot_owner_id: req.user.ownerId,
        hs_call_to_number: phoneNumber,
        hs_call_title: `Llamada - ${outcomeLabel}`,
      }
    })
    const callId = r.data.id
    if (objectType && objectId) {
      try {
        await hs.put(`/crm/v3/objects/calls/${callId}/associations/${objectType}/${objectId}/${assocTypeMap[objectType] || 'call_to_deal'}`)
      } catch (assocErr) {
        console.warn('[calls] association error:', assocErr.message)
      }
    }
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
    const ownerId = req.user.role === 'supervisor'
      ? (assignedOwnerId || req.user.ownerId)
      : req.user.ownerId
    const r = await hs.post('/crm/v3/objects/tasks', {
      properties: {
        hs_task_subject: subject,
        hs_task_body: body,
        hs_timestamp: new Date(dueDate).toISOString(),
        hs_task_priority: priority,
        hs_task_status: 'NOT_STARTED',
        hubspot_owner_id: ownerId
      }
    })
    const taskId = r.data.id
    if (associatedObjectType && associatedObjectId) {
      const assocTypeMap = {
        deals: 'task_to_deal',
        contacts: 'task_to_contact',
        companies: 'task_to_company'
      }
      try {
        await hs.put(`/crm/v3/objects/tasks/${taskId}/associations/${associatedObjectType}/${associatedObjectId}/${assocTypeMap[associatedObjectType] || 'task_to_deal'}`)
      } catch (assocErr) {
        console.warn('[tasks] association error:', assocErr.message)
      }
    }
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
    countPerOwner([{ propertyName: 'dealstage', operator: 'EQ', value: 'confirmada_bepharma' }]),
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

  // HubSpot
  try {
    await hs.get('/crm/v3/owners', { params: { limit: 1 } })
    results.hubspot = { ok: true, label: 'Conectado' }
  } catch (e) {
    const status = e.response?.status
    const hasToken = !!process.env.HUBSPOT_ACCESS_TOKEN
    const tokenPreview = hasToken ? process.env.HUBSPOT_ACCESS_TOKEN.slice(0, 12) + '...' : 'NO CONFIGURADO'
    results.hubspot = {
      ok: false,
      label: status === 401 ? 'Token invalido' : status === 403 ? 'Sin permisos' : `Error ${status || 'red'}: ${e.message?.slice(0, 60)}`,
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
      const results = await Promise.all(ownerIds.map(ownerId =>
        hs.post(`/crm/v3/objects/${engType}/search`, {
          filterGroups: [{
            filters: [
              { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
              { propertyName: 'hs_createdate', operator: 'GTE', value: since }
            ]
          }],
          limit: 1, properties: ['hs_createdate']
        }).then(r => [ownerId, r.data.total || 0])
          .catch(() => [ownerId, 0])
      ))
      return Object.fromEntries(results)
    }

    const countDealsByOwner = () => Promise.all(ownerIds.map(ownerId =>
      hs.post('/crm/v3/objects/deals/search', {
        filterGroups: [{
          filters: [
            { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
            { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
            { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' }
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
// REPORTES — historial de llamadas de un operador
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/reports/calls', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor') return res.status(403).json({ error: 'Solo supervisores' })
  try {
    const { ownerId, days = 30 } = req.query
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString()
    const filters = [{ propertyName: 'hs_createdate', operator: 'GTE', value: since }]
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
    const fs = require('fs')
    const path = require('path')
    let hubspotOwnerId = null
    try {
      const usersData = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8'))
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
