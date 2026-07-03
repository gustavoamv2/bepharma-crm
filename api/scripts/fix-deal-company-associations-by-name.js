// Script de un solo uso: asocia los deals huérfanos (SIN ninguna empresa
// asociada) del evento activo, para el lote que NO se puede resolver por
// dominio (los scripts fix-deal-company-associations-*.js matchean por
// dominio; estos 1,133 deals vienen de un import distinto que no cargó
// dominio en la empresa).
//
// Contexto (03-jul-2026): estos deals tienen el patrón de nombre invertido
// "{Empresa} - BEPH-2026-09" (los que sí quedaron bien asociados tienen
// "BEPH-2026-09 - {Empresa}"). Al revisar, muchas de esas empresas están
// DUPLICADAS -- ej. "Medifarma" existe 3 veces con bp_zona=yesenia, las 3
// sin dominio, creadas en el mismo segundo del import. Por eso este script
// matchea por NOMBRE (no dominio) pero siempre restringido a la MISMA zona
// del dueño del deal, y si encuentra 2+ empresas candidatas para el mismo
// nombre+zona lo marca como AMBIGUO y no asocia nada -- esos quedan para
// fusionar (Merge nativo de HubSpot) antes de poder asociarlos.
//
// Salida: además de asociar lo que sí es seguro, deja un reporte en
// api/scripts/data/orphans-report.json con 3 grupos para revisar después:
//   - ambiguos: mismo nombre+zona con 2+ empresas candidatas (necesitan merge)
//   - sinEmpresa: no se encontró ninguna empresa con ese nombre en esa zona
//   - patronInvalido: el dealname no sigue el patrón "{Empresa} - EVENTO"
//   - sinZona: el dueño del deal no tiene zona mapeada en users.json
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/fix-deal-company-associations-by-name.js --dry-run
//   node api/scripts/fix-deal-company-associations-by-name.js --confirm
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN).

require('dotenv').config()
const axios = require('axios')
const readline = require('readline')
const path = require('path')
const fs = require('fs')

const { ACTIVE_EVENT } = require('../config/hubspotProperties')
const usersJson = require('../users.json')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('No se encontro HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200
const DEAL_TO_COMPANY_ASSOCIATION_TYPE_ID = 5 // confirmado en el escenario Make "Creacion de evento"
const REPORT_FILE = path.join(__dirname, 'data', 'orphans-report.json')

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ownerId (hubspot_owner_id) -> zona (username en users.json, coincide con bp_zona)
const ownerIdToZona = {}
for (const [username, u] of Object.entries(usersJson)) {
  if (u.ownerId) ownerIdToZona[String(u.ownerId)] = username
}

const SUFFIX_RE = new RegExp(`\\s*-\\s*${escapeRegex(ACTIVE_EVENT)}\\s*$`, 'i')

async function fetchOrphanDeals() {
  // 1) todos los deals del evento activo
  let allDeals = []
  let after
  while (true) {
    const { data } = await hs.post('/crm/v3/objects/deals/search', {
      filterGroups: [{ filters: [{ propertyName: 'bp_evento_codigo', operator: 'EQ', value: ACTIVE_EVENT }] }],
      limit: 100, after,
      properties: ['dealname', 'hubspot_owner_id'],
    })
    allDeals.push(...(data.results || []))
    process.stdout.write(`\r  Deals del evento leídos: ${allDeals.length}…`)
    after = data.paging?.next?.after
    if (!after) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')

  // 2) resolver empresa asociada a cada deal (batch v4)
  const companyIdByDeal = {}
  for (let i = 0; i < allDeals.length; i += BATCH_SIZE) {
    const chunk = allDeals.slice(i, i + BATCH_SIZE)
    const { data } = await hs.post('/crm/v4/associations/deals/companies/batch/read', {
      inputs: chunk.map(d => ({ id: d.id })),
    })
    ;(data.results || []).forEach(row => {
      const first = row.to?.[0]?.toObjectId
      if (first) companyIdByDeal[row.from.id] = String(first)
    })
    process.stdout.write(`\r  Empresas resueltas: ${Math.min(i + BATCH_SIZE, allDeals.length)}/${allDeals.length}…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')

  return allDeals.filter(d => !companyIdByDeal[d.id])
}

async function fetchCompaniesByZonaAndName() {
  // (zona::nombre normalizado) -> [companyId, ...]
  const map = new Map()
  let leidas = 0
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/companies', {
      params: { limit: 100, properties: 'name,bp_zona', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      leidas++
      const zona = norm(r.properties.bp_zona)
      const name = norm(r.properties.name)
      if (!zona || !name) continue
      const key = `${zona}::${name}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r.id)
    }
    process.stdout.write(`\r  Empresas leídas (portal completo): ${leidas}…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return map
}

async function createAssociationBatch(pairs) {
  const inputs = pairs.map(p => ({
    from: { id: p.dealId },
    to: { id: p.companyId },
    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: DEAL_TO_COMPANY_ASSOCIATION_TYPE_ID }],
  }))
  await hs.post('/crm/v4/associations/deals/companies/batch/create', { inputs })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto va a asociar Deals con Empresas existentes en HubSpot.\nEscribe exactamente "ASOCIAR DEALS" para continuar: ', resolve)
  })
  rl.close()
  return answer.trim() === 'ASOCIAR DEALS'
}

async function main() {
  console.log(DRY_RUN ? 'Modo: --dry-run (solo matching, no asocia nada)\n' : 'Modo: ASOCIACION REAL\n')
  console.log(`Evento activo: ${ACTIVE_EVENT}\n`)

  console.log('Buscando deals sin ninguna empresa asociada…')
  const orphans = await fetchOrphanDeals()
  console.log(`Deals huérfanos encontrados: ${orphans.length}\n`)

  if (orphans.length === 0) {
    console.log('✅ Nada pendiente.')
    return
  }

  console.log('Descargando empresas del portal (agrupadas por zona + nombre)…')
  const companiesByZonaName = await fetchCompaniesByZonaAndName()
  console.log('')

  const toAssociate = []
  const ambiguos = []       // mismo nombre+zona con 2+ empresas
  const sinEmpresa = []     // no se encontró ninguna empresa con ese nombre en esa zona
  const patronInvalido = [] // el dealname no sigue "{Empresa} - EVENTO"
  const sinZona = []        // el owner del deal no tiene zona mapeada

  for (const deal of orphans) {
    const dealname = deal.properties?.dealname || ''
    const ownerId = deal.properties?.hubspot_owner_id
    const zona = ownerId ? ownerIdToZona[String(ownerId)] : null

    if (!SUFFIX_RE.test(dealname)) {
      patronInvalido.push({ dealId: deal.id, dealname, ownerId })
      continue
    }
    if (!zona) {
      sinZona.push({ dealId: deal.id, dealname, ownerId })
      continue
    }

    const companyName = norm(dealname.replace(SUFFIX_RE, ''))
    const key = `${zona}::${companyName}`
    const candidates = companiesByZonaName.get(key) || []

    if (candidates.length === 0) {
      sinEmpresa.push({ dealId: deal.id, dealname, zona, companyNameBuscado: companyName })
    } else if (candidates.length > 1) {
      ambiguos.push({ dealId: deal.id, dealname, zona, companyNameBuscado: companyName, companiesCandidatas: candidates })
    } else {
      toAssociate.push({ dealId: deal.id, companyId: candidates[0], dealname })
    }
  }

  console.log(`Listos para asociar (match único): ${toAssociate.length}`)
  console.log(`Ambiguos — mismo nombre+zona con 2+ empresas (necesitan Merge primero): ${ambiguos.length}`)
  console.log(`Sin empresa encontrada con ese nombre en esa zona: ${sinEmpresa.length}`)
  console.log(`Patrón de nombre inesperado (no termina en "- ${ACTIVE_EVENT}"): ${patronInvalido.length}`)
  console.log(`Sin zona mapeada (owner no está en users.json): ${sinZona.length}`)

  // Siempre se deja el reporte, aplique o no --confirm, para poder revisarlo despues.
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true })
  fs.writeFileSync(REPORT_FILE, JSON.stringify({
    generadoEn: new Date().toISOString(),
    evento: ACTIVE_EVENT,
    totalHuerfanos: orphans.length,
    resueltosEstaCorrida: toAssociate.length,
    ambiguos,
    sinEmpresa,
    patronInvalido,
    sinZona,
  }, null, 2))
  console.log(`\n📄 Reporte guardado en: ${REPORT_FILE}`)

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run activo: no se asoció nada. Corre con --confirm para asociar los casos seguros.')
    return
  }

  if (toAssociate.length === 0) {
    console.log('\n✅ Nada seguro para asociar en esta corrida.')
    return
  }

  const ok = await confirmPhrase()
  if (!ok) {
    console.log('❌ Cancelado — no se asoció nada.')
    return
  }

  console.log('\nAsociando en lotes de 100…')
  let done = 0
  for (let i = 0; i < toAssociate.length; i += BATCH_SIZE) {
    const chunk = toAssociate.slice(i, i + BATCH_SIZE)
    try {
      await createAssociationBatch(chunk)
    } catch (e) {
      console.error(`\n❌ Error en lote ${i / BATCH_SIZE + 1}:`, e.response?.data || e.message)
      console.error('   Continuando con el siguiente lote…')
    }
    done += chunk.length
    process.stdout.write(`\r  ${done}/${toAssociate.length} asociaciones procesadas…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log(`\n\n✅ Listo. ${done} deals asociados a su empresa.`)
  console.log(`   Quedan pendientes de revisión manual: ${ambiguos.length + sinEmpresa.length + patronInvalido.length + sinZona.length} (ver ${REPORT_FILE})`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
