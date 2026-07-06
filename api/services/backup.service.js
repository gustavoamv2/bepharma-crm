// backup.service.js — arma una copia de seguridad completa del sistema.
//
// El CRM no tiene una base de datos SQL propia: los registros de negocio
// (Empresas/Contactos/Deals) viven en HubSpot, y la configuración propia del
// CRM que NO vive en HubSpot (usuarios, roles, países asignados, extensión
// SIP, firmas y plantillas de email) vive en api/users.json + Redis/Upstash
// (o /tmp como fallback — ver usersStore.js/signatureStore.js). Un backup
// "completo" tiene que cubrir ambas fuentes, si no, perder el commit de
// users.json deja al CRM sin saber qué operador ve qué país.
//
// Deliberadamente NO incluye contraseñas (hash bcrypt) ni EMAIL_PASS por
// usuario: este backup se descarga desde el panel de Admin y además se
// envía por correo automáticamente cada semana (ver /api/cron/backup en
// server.js), así que cualquier credencial ahí sería una fuga innecesaria.
// Restaurar el acceso de un usuario se hace con el flujo normal de "olvidé
// mi contraseña" (/api/auth/forgot-password), no reinyectando el hash viejo.

const { hs } = require('../repositories/hubspot.repository')
const { COMPANY_PROPERTIES, CONTACT_PROPERTIES, DEAL_PROPERTIES } = require('../config/hubspotProperties')
const { loadUsers } = require('../usersStore')
const { getSignature } = require('../signatureStore')
const { getTemplates } = require('../emailTemplatesStore')
const { buildBackupWorkbook, workbookToBuffer } = require('./excelExport.service')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// Hasta 10,000 registros por tipo (100 páginas x 100) — margen amplio sobre
// las ~3,000 empresas de este proyecto, con espacio para crecer.
const MAX_PAGES = 100

async function fetchAll(objectType, properties) {
  const all = []
  let after
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(260) // mismo respeto al rate limit de HubSpot que /export
    const r = await hs.post(`/crm/v3/objects/${objectType}/search`, {
      filterGroups: [],
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      limit: 100,
      after,
      properties,
    })
    all.push(...(r.data.results || []))
    after = r.data.paging?.next?.after
    if (!after) break
  }
  return all
}

// Quita password/emailPass de cada usuario antes de exponerlos en el backup.
function sanitizeUsers(users) {
  return Object.fromEntries(
    Object.entries(users).map(([username, u]) => {
      const { password, emailPass, ...safe } = u
      return [username, safe]
    })
  )
}

// Arma el objeto de datos crudo — usado tanto para el backup en JSON como de
// insumo para armar el .xlsx.
async function buildFullBackupData() {
  const [companies, contacts, deals] = await Promise.all([
    fetchAll('companies', COMPANY_PROPERTIES),
    fetchAll('contacts', CONTACT_PROPERTIES),
    fetchAll('deals', DEAL_PROPERTIES),
  ])

  const users = loadUsers()
  const safeUsers = sanitizeUsers(users)

  const signatures = {}
  const templates = {}
  for (const username of Object.keys(users)) {
    signatures[username] = await getSignature(username).catch(() => null)
    templates[username] = await getTemplates(username).catch(() => [])
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      companies: companies.length,
      contacts: contacts.length,
      deals: deals.length,
      users: Object.keys(users).length,
    },
    companies,
    contacts,
    deals,
    users: safeUsers,
    signatures,
    templates,
  }
}

// Convierte el objeto de datos ya armado (buildFullBackupData) a un workbook
// con una hoja por tipo de dato.
async function buildFullBackupWorkbook(data, generadoPor) {
  const colsFor = (properties) => [
    { header: 'ID', key: 'id', width: 14 },
    ...properties.map(p => ({ header: p, key: p, width: 20 })),
  ]
  const rowsFromRecords = (records, properties) => records.map(r => ({
    id: r.id,
    ...properties.reduce((acc, p) => { acc[p] = r.properties?.[p] ?? ''; return acc }, {}),
  }))

  const usersRows = Object.entries(data.users).map(([username, u]) => ({
    username,
    name: u.name || '',
    role: u.role || '',
    ownerId: u.ownerId || '',
    sipExtension: u.sipExtension || '',
    emailUser: u.emailUser || '',
    bp_paises: Array.isArray(u.bp_paises) ? u.bp_paises.join(', ') : '',
  }))
  const usersCols = [
    { header: 'Usuario', key: 'username', width: 16 },
    { header: 'Nombre', key: 'name', width: 22 },
    { header: 'Rol', key: 'role', width: 14 },
    { header: 'Owner ID', key: 'ownerId', width: 14 },
    { header: 'Extensión SIP', key: 'sipExtension', width: 14 },
    { header: 'Email configurado', key: 'emailUser', width: 26 },
    { header: 'Países asignados', key: 'bp_paises', width: 60 },
  ]

  const firmasRows = Object.entries(data.signatures)
    .filter(([, v]) => v)
    .map(([username, sig]) => ({
      username,
      contenido: typeof sig === 'string' ? sig : (sig?.html || JSON.stringify(sig)),
    }))
  const firmasCols = [
    { header: 'Usuario', key: 'username', width: 16 },
    { header: 'Firma (HTML)', key: 'contenido', width: 80 },
  ]

  const plantillasRows = Object.entries(data.templates).flatMap(([username, list]) =>
    (Array.isArray(list) ? list : []).map(t => ({
      username,
      nombre: t.name || '',
      asunto: t.subject || '',
      cuerpo: t.bodyHtml || '',
    }))
  )
  const plantillasCols = [
    { header: 'Usuario', key: 'username', width: 16 },
    { header: 'Nombre plantilla', key: 'nombre', width: 24 },
    { header: 'Asunto', key: 'asunto', width: 30 },
    { header: 'Cuerpo (HTML)', key: 'cuerpo', width: 80 },
  ]

  const workbook = await buildBackupWorkbook({
    generadoPor,
    generatedAt: data.generatedAt,
    sheets: [
      { sheetName: 'Empresas', columns: colsFor(COMPANY_PROPERTIES), rows: rowsFromRecords(data.companies, COMPANY_PROPERTIES) },
      { sheetName: 'Contactos', columns: colsFor(CONTACT_PROPERTIES), rows: rowsFromRecords(data.contacts, CONTACT_PROPERTIES) },
      { sheetName: 'Deals', columns: colsFor(DEAL_PROPERTIES), rows: rowsFromRecords(data.deals, DEAL_PROPERTIES) },
      { sheetName: 'Usuarios', columns: usersCols, rows: usersRows },
      { sheetName: 'Firmas', columns: firmasCols, rows: firmasRows },
      { sheetName: 'Plantillas', columns: plantillasCols, rows: plantillasRows },
    ],
  })

  return workbookToBuffer(workbook)
}

module.exports = { buildFullBackupData, buildFullBackupWorkbook }
