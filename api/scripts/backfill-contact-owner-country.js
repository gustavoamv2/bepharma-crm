// Script de backfill: llena "hubspot_owner_id" y "country" en los Contactos
// que los tengan vacíos, tomando ambos datos de la Empresa asociada a cada
// contacto.
//
// Por qué existe (04-jul-2026): la vista de operador no muestra Contactos.
// Causa raíz, confirmada vía query_crm_data:
//   - SOLO 18 de 8,690 Contactos tienen "hubspot_owner_id" (el resto quedó
//     vacío porque transform_operator_excel_*.py NUNCA escribe ese campo en
//     la hoja CONTACTOS -- sólo lo escribe en DEALS y MOVIMIENTOS_DEAL).
//   - Sólo 3,553 de 8,690 tienen "country" (HubSpot lo infiere de la empresa
//     a veces al asociar, pero no siempre).
// `/api/hubspot/contacts/search` (api/server.js) aplica AMBOS filtros para
// vista de operador (applyOwnerFilter + applyCountryFilter, en AND) -- si
// cualquiera de los dos está vacío en el contacto, el contacto desaparece de
// su vista, aunque el contacto SÍ tenga una empresa asociada correctamente
// zonificada. Mismo patrón de bug que bp_evento_paises en Deals (ver
// backfill-deal-paises.js), pero acá son 2 propiedades en vez de 1, y la
// fuente del owner es la ZONA de la empresa (bp_zona), no el país.
//
// Fuente de verdad: bp_zona/country de la Empresa asociada a cada contacto
// (primera empresa si hay más de una asociada). El mapeo zona -> ownerId sale
// de api/users.json (mismo archivo que usa el login).
//
// Este script SOLO llena campos vacíos -- nunca pisa un hubspot_owner_id o
// country que el contacto ya tenga.
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/backfill-contact-owner-country.js --dry-run
//   node api/scripts/backfill-contact-owner-country.js --confirm

require('dotenv').config()
const axios = require('axios')
const readline = require('readline')
const path = require('path')
const fs = require('fs')

const USERS = require('../users.json')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('No se encontro HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200
const REPORT_FILE = path.join(__dirname, 'data', 'backfill-contact-owner-country-report.json')

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// zona (bp_zona / username del operador) -> ownerId, sólo para roles 'operator'
// (Roberto no tiene zona propia; Yesenia sí opera su propia zona además de
// supervisar, ver users.json).
const ZONA_TO_OWNER = {}
for (const [username, u] of Object.entries(USERS)) {
  if (u.ownerId) ZONA_TO_OWNER[username] = u.ownerId
}
console.log('Mapa zona -> ownerId:', ZONA_TO_OWNER)

// ── 1. Empresas: bp_zona + country ────────────────────────────────────────
async function fetchCompanyZonaCountry() {
  const zonaById = {}
  const countryById = {}
  let after
  let total = 0
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/companies', {
      params: { limit: 100, properties: 'bp_zona,country', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      if (r.properties?.bp_zona) zonaById[r.id] = r.properties.bp_zona.trim().toLowerCase()
      if (r.properties?.country) countryById[r.id] = r.properties.country
    }
    total += results.length
    process.stdout.write(`\r  Empresas leídas: ${total}…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return { zonaById, countryById }
}

// ── 2. Contactos: hubspot_owner_id + country + empresa asociada ──────────
async function fetchContacts() {
  const contacts = []
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/contacts', {
      params: {
        limit: 100,
        properties: 'hubspot_owner_id,country,firstname,lastname',
        associations: 'companies',
        ...(after ? { after } : {}),
      },
    })
    const results = data.results || []
    contacts.push(...results)
    process.stdout.write(`\r  Contactos leídos: ${contacts.length}…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return contacts
}

async function updateContactsBatch(updates) {
  await hs.post('/crm/v3/objects/contacts/batch/update', {
    inputs: updates.map(u => ({ id: u.contactId, properties: u.properties })),
  })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto va a escribir hubspot_owner_id y/o country en los contactos listados arriba.\nEscribe exactamente "LLENAR CONTACTOS" para continuar: ', resolve)
  })
  rl.close()
  return answer.trim() === 'LLENAR CONTACTOS'
}

async function main() {
  console.log(DRY_RUN ? 'Modo: --dry-run (solo calcula, no escribe nada)\n' : 'Modo: ESCRITURA REAL\n')

  console.log('Descargando bp_zona/country de todas las empresas…')
  const { zonaById, countryById } = await fetchCompanyZonaCountry()
  console.log(`Empresas con bp_zona: ${Object.keys(zonaById).length}, con country: ${Object.keys(countryById).length}\n`)

  console.log('Descargando todos los contactos (con empresa asociada)…')
  const contacts = await fetchContacts()
  console.log(`Total contactos: ${contacts.length}\n`)

  const toUpdate = []
  const sinEmpresa = []
  const empresaSinZona = []
  const zonaSinOwner = []
  let soloOwner = 0, soloCountry = 0, ambos = 0

  for (const c of contacts) {
    const needsOwner = !c.properties?.hubspot_owner_id
    const needsCountry = !c.properties?.country
    if (!needsOwner && !needsCountry) continue // ya completo, no tocar

    const companyId = c.associations?.companies?.results?.[0]?.id
    const nombre = `${c.properties?.firstname || ''} ${c.properties?.lastname || ''}`.trim()
    if (!companyId) { sinEmpresa.push({ contactId: c.id, nombre }); continue }

    const zona = zonaById[companyId]
    const country = countryById[companyId]

    const properties = {}
    if (needsOwner) {
      if (!zona) { empresaSinZona.push({ contactId: c.id, nombre, companyId }); }
      else if (!ZONA_TO_OWNER[zona]) { zonaSinOwner.push({ contactId: c.id, nombre, companyId, zona }); }
      else properties.hubspot_owner_id = ZONA_TO_OWNER[zona]
    }
    if (needsCountry && country) {
      properties.country = country
    }

    if (Object.keys(properties).length > 0) {
      toUpdate.push({ contactId: c.id, properties })
      if (properties.hubspot_owner_id && properties.country) ambos++
      else if (properties.hubspot_owner_id) soloOwner++
      else soloCountry++
    }
  }

  console.log(`Listos para actualizar: ${toUpdate.length} (ambos campos: ${ambos}, sólo owner: ${soloOwner}, sólo country: ${soloCountry})`)
  console.log(`Sin empresa asociada: ${sinEmpresa.length}`)
  console.log(`Empresa sin bp_zona: ${empresaSinZona.length}`)
  console.log(`Zona sin owner conocido: ${zonaSinOwner.length}`)

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true })
  fs.writeFileSync(REPORT_FILE, JSON.stringify({
    generadoEn: new Date().toISOString(),
    totalContactos: contacts.length,
    resueltosEstaCorrida: toUpdate.length,
    sinEmpresa,
    empresaSinZona,
    zonaSinOwner,
  }, null, 2))
  console.log(`\n📄 Reporte guardado en: ${REPORT_FILE}`)

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run activo: no se escribió nada. Corre con --confirm para aplicar los cambios.')
    return
  }

  if (toUpdate.length === 0) {
    console.log('\n✅ Nada seguro para actualizar en esta corrida.')
    return
  }

  const ok = await confirmPhrase()
  if (!ok) {
    console.log('❌ Cancelado — no se escribió nada.')
    return
  }

  console.log('\nActualizando en lotes de 100…')
  let done = 0
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE)
    try {
      await updateContactsBatch(chunk)
    } catch (e) {
      console.error(`\n❌ Error en lote ${i / BATCH_SIZE + 1}:`, e.response?.data || e.message)
      console.error('   Continuando con el siguiente lote…')
    }
    done += chunk.length
    process.stdout.write(`\r  ${done}/${toUpdate.length} contactos actualizados…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log(`\n\n✅ Listo. ${done} contactos actualizados (hubspot_owner_id y/o country).`)
  console.log(`   Quedan pendientes de revisión manual: ${sinEmpresa.length + empresaSinZona.length + zonaSinOwner.length} (ver ${REPORT_FILE})`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
