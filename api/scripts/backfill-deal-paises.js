// Script de backfill: llena la propiedad "bp_evento_paises" en los deals que
// la tengan vacía, tomando el país de la empresa asociada a cada deal.
//
// Por qué existe (03-jul-2026): el dashboard filtra los deals de cada
// operador por bp_evento_paises IN [países asignados al operador] (ver
// applyCountryFilter en api/auth.js). Esa propiedad está vacía en el 100% de
// los deals del portal -- por eso cualquier vista de operador en el
// dashboard aparece sin registros (el filtro no matchea nada), mientras que
// la vista de supervisor (que no aplica ese filtro) sí ve todo.
//
// bp_evento_paises es tipo texto libre (no checkbox), así que cada deal
// guarda UN solo país -- coincide con el modelo 1 deal = 1 empresa = 1 país.
// El país sale de la propiedad "country" de la empresa asociada, normalizado
// (sin acentos / mayúsculas) contra el catálogo de api/config/countries.js
// para cubrir variantes como "Turquia" (sin acento, como quedó en el import)
// o si por alguna empresa quedó guardado en inglés ("Turkey").
//
// Deja siempre un reporte en api/scripts/data/paises-report.json con lo que
// no se pudo resolver: sinEmpresa (deal sin empresa asociada), empresaSinPais
// (empresa sin campo "country"), paisNoReconocido (el valor de "country" no
// matchea ningún país del catálogo -- revisar/agregar alias).
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/backfill-deal-paises.js --dry-run
//   node api/scripts/backfill-deal-paises.js --confirm

require('dotenv').config()
const axios = require('axios')
const readline = require('readline')
const path = require('path')
const fs = require('fs')

const { ACTIVE_EVENT } = require('../config/hubspotProperties')
const { COUNTRIES } = require('../config/countries')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('No se encontro HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200
const REPORT_FILE = path.join(__dirname, 'data', 'paises-report.json')

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── Normalización / catálogo de países ───────────────────────────────────────
// Mapa explícito de acentos (en vez de rangos unicode en regex, que son
// frágiles si el archivo pasa por herramientas o syncs que no preservan bien
// UTF-8) -- cubre todos los acentos que aparecen en config/countries.js.
const ACCENT_MAP = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ñ: 'N', Ü: 'U',
}
const stripAccents = (s) => (s || '').split('').map(ch => ACCENT_MAP[ch] || ch).join('')
const normKey = (s) => stripAccents(s).trim().toLowerCase()

const byLabelNorm = new Map(COUNTRIES.map(c => [normKey(c.label), c.label]))
const byEnNorm = new Map(COUNTRIES.map(c => [normKey(c.en), c.label]))

// Dado el valor crudo de "country" en una empresa, devuelve el label en
// español (con acentos) tal como se guarda bp_paises/bp_evento_paises, o
// null si no matchea ningún país conocido.
function resolveCountryLabel(rawCountry) {
  const key = normKey(rawCountry)
  if (!key) return null
  return byLabelNorm.get(key) || byEnNorm.get(key) || null
}

async function fetchDealsSinPais() {
  let allDeals = []
  let after
  while (true) {
    const { data } = await hs.post('/crm/v3/objects/deals/search', {
      filterGroups: [{ filters: [
        { propertyName: 'bp_evento_codigo', operator: 'EQ', value: ACTIVE_EVENT },
        { propertyName: 'bp_evento_paises', operator: 'NOT_HAS_PROPERTY' },
      ] }],
      limit: 100, after,
      properties: ['dealname'],
    })
    allDeals.push(...(data.results || []))
    process.stdout.write(`\r  Deals sin país leídos: ${allDeals.length}…`)
    after = data.paging?.next?.after
    if (!after) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return allDeals
}

async function resolveCompanyIdsByDeal(deals) {
  const companyIdByDeal = {}
  for (let i = 0; i < deals.length; i += BATCH_SIZE) {
    const chunk = deals.slice(i, i + BATCH_SIZE)
    const { data } = await hs.post('/crm/v4/associations/deals/companies/batch/read', {
      inputs: chunk.map(d => ({ id: d.id })),
    })
    ;(data.results || []).forEach(row => {
      const first = row.to?.[0]?.toObjectId
      if (first) companyIdByDeal[row.from.id] = String(first)
    })
    process.stdout.write(`\r  Empresas resueltas: ${Math.min(i + BATCH_SIZE, deals.length)}/${deals.length}…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return companyIdByDeal
}

async function fetchCompanyCountries(companyIds) {
  const countryByCompany = {}
  for (let i = 0; i < companyIds.length; i += BATCH_SIZE) {
    const chunk = companyIds.slice(i, i + BATCH_SIZE)
    const { data } = await hs.post('/crm/v3/objects/companies/batch/read', {
      inputs: chunk.map(id => ({ id })),
      properties: ['country'],
    })
    ;(data.results || []).forEach(r => {
      countryByCompany[r.id] = r.properties?.country || ''
    })
    process.stdout.write(`\r  Países de empresa leídos: ${Math.min(i + BATCH_SIZE, companyIds.length)}/${companyIds.length}…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return countryByCompany
}

async function updateDealsBatch(pairs) {
  await hs.post('/crm/v3/objects/deals/batch/update', {
    inputs: pairs.map(p => ({ id: p.dealId, properties: { bp_evento_paises: p.pais } })),
  })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto va a escribir bp_evento_paises en los deals listados arriba.\nEscribe exactamente "LLENAR PAISES" para continuar: ', resolve)
  })
  rl.close()
  return answer.trim() === 'LLENAR PAISES'
}

async function main() {
  console.log(DRY_RUN ? 'Modo: --dry-run (solo calcula, no escribe nada)\n' : 'Modo: ESCRITURA REAL\n')
  console.log(`Evento activo: ${ACTIVE_EVENT}\n`)

  console.log('Buscando deals sin bp_evento_paises…')
  const deals = await fetchDealsSinPais()
  console.log(`Deals sin país: ${deals.length}\n`)

  if (deals.length === 0) {
    console.log('✅ Nada pendiente.')
    return
  }

  console.log('Resolviendo la empresa asociada a cada deal…')
  const companyIdByDeal = await resolveCompanyIdsByDeal(deals)
  const uniqueCompanyIds = [...new Set(Object.values(companyIdByDeal))]
  console.log(`Empresas únicas a consultar: ${uniqueCompanyIds.length}\n`)

  console.log('Descargando el país de cada empresa…')
  const countryByCompany = await fetchCompanyCountries(uniqueCompanyIds)
  console.log('')

  const toUpdate = []
  const sinEmpresa = []
  const empresaSinPais = []
  const paisNoReconocido = []

  for (const deal of deals) {
    const dealname = deal.properties?.dealname || ''
    const companyId = companyIdByDeal[deal.id]
    if (!companyId) { sinEmpresa.push({ dealId: deal.id, dealname }); continue }

    const rawCountry = countryByCompany[companyId]
    if (!rawCountry) { empresaSinPais.push({ dealId: deal.id, dealname, companyId }); continue }

    const label = resolveCountryLabel(rawCountry)
    if (!label) { paisNoReconocido.push({ dealId: deal.id, dealname, companyId, rawCountry }); continue }

    toUpdate.push({ dealId: deal.id, pais: label })
  }

  console.log(`Listos para actualizar (país reconocido): ${toUpdate.length}`)
  console.log(`Sin empresa asociada: ${sinEmpresa.length}`)
  console.log(`Empresa sin campo "country": ${empresaSinPais.length}`)
  console.log(`País no reconocido en el catálogo: ${paisNoReconocido.length}`)

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true })
  fs.writeFileSync(REPORT_FILE, JSON.stringify({
    generadoEn: new Date().toISOString(),
    evento: ACTIVE_EVENT,
    totalSinPais: deals.length,
    resueltosEstaCorrida: toUpdate.length,
    sinEmpresa,
    empresaSinPais,
    paisNoReconocido,
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
      await updateDealsBatch(chunk)
    } catch (e) {
      console.error(`\n❌ Error en lote ${i / BATCH_SIZE + 1}:`, e.response?.data || e.message)
      console.error('   Continuando con el siguiente lote…')
    }
    done += chunk.length
    process.stdout.write(`\r  ${done}/${toUpdate.length} deals actualizados…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log(`\n\n✅ Listo. ${done} deals con bp_evento_paises actualizado.`)
  console.log(`   Quedan pendientes de revisión manual: ${sinEmpresa.length + empresaSinPais.length + paisNoReconocido.length} (ver ${REPORT_FILE})`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
