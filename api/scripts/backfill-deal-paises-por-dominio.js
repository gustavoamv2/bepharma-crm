// Script de backfill (segunda pasada): llena "bp_evento_paises" en los deals
// que backfill-deal-paises.js no pudo resolver porque su empresa no tenía
// "country" cargado -- para este subgrupo (~766, el 93% de Angel) la empresa
// SÍ tiene dominio, así que se infiere el país por el código de país del
// dominio (ccTLD): pharmax.ae → Emiratos Árabes Unidos, unifarm.it → Italia,
// essencegp.com.au → Australia, etc.
//
// A PROPÓSITO NO se infiere nada por el nombre de la empresa (sufijos como
// "Pvt. Ltd." o "S.p.A." son pistas, no datos) -- Gustavo pidió solo la vía
// segura por dominio. Dominios genéricos (.com, .net, .org, .io, .co, etc.)
// se dejan sin resolver a propósito porque no dicen nada confiable del país.
//
// Deja reporte en api/scripts/data/paises-dominio-report.json con lo no
// resuelto (dominio genérico, sin dominio, o ccTLD de un país fuera del
// catálogo de api/config/countries.js).
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/backfill-deal-paises-por-dominio.js --dry-run
//   node api/scripts/backfill-deal-paises-por-dominio.js --confirm

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
const REPORT_FILE = path.join(__dirname, 'data', 'paises-dominio-report.json')

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── ccTLD → país (nombre en inglés, para reusar el catálogo de countries.js) ─
// Solo códigos de país reales (ISO 3166) -- los genéricos (.com, .io, .co,
// .me, .tv, .ai, etc.) quedan fuera a propósito: se usan tanto como dominio
// "de marca" que no dicen nada confiable sobre el país real de la empresa.
const CCTLD_TO_EN = {
  de: 'Germany', ag: 'Antigua and Barbuda', ar: 'Argentina', au: 'Australia',
  at: 'Austria', bs: 'Bahamas', bb: 'Barbados', bz: 'Belize', be: 'Belgium',
  bo: 'Bolivia', br: 'Brazil', bg: 'Bulgaria', ca: 'Canada', cl: 'Chile',
  cn: 'China', kr: 'South Korea', cr: 'Costa Rica', hr: 'Croatia', cu: 'Cuba',
  dk: 'Denmark', dm: 'Dominica', ec: 'Ecuador', eg: 'Egypt', sv: 'El Salvador',
  ae: 'United Arab Emirates', sk: 'Slovakia', es: 'Spain', us: 'United States',
  et: 'Ethiopia', ph: 'Philippines', fi: 'Finland', fr: 'France', ge: 'Georgia',
  gh: 'Ghana', gd: 'Grenada', gr: 'Greece', gt: 'Guatemala', gy: 'Guyana',
  ht: 'Haiti', hn: 'Honduras', hu: 'Hungary', in: 'India', id: 'Indonesia',
  ir: 'Iran', iq: 'Iraq', ie: 'Ireland', is: 'Iceland', il: 'Israel',
  it: 'Italy', jm: 'Jamaica', jp: 'Japan', jo: 'Jordan', kz: 'Kazakhstan',
  ke: 'Kenya', my: 'Malaysia', ma: 'Morocco', mx: 'Mexico', md: 'Moldova',
  ni: 'Nicaragua', ng: 'Nigeria', no: 'Norway', nz: 'New Zealand',
  nl: 'Netherlands', pk: 'Pakistan', pa: 'Panama', py: 'Paraguay', pe: 'Peru',
  pl: 'Poland', pt: 'Portugal', pr: 'Puerto Rico', qa: 'Qatar',
  uk: 'United Kingdom', gb: 'United Kingdom', cz: 'Czech Republic',
  do: 'Dominican Republic', ro: 'Romania', ru: 'Russia', sa: 'Saudi Arabia',
  kn: 'Saint Kitts and Nevis', vc: 'Saint Vincent and the Grenadines',
  lc: 'Saint Lucia', rs: 'Serbia', sg: 'Singapore', lk: 'Sri Lanka',
  za: 'South Africa', se: 'Sweden', ch: 'Switzerland', sr: 'Suriname',
  th: 'Thailand', tw: 'Taiwan', tt: 'Trinidad and Tobago', tr: 'Turkey',
  ua: 'Ukraine', uy: 'Uruguay', ve: 'Venezuela', vn: 'Vietnam',
}
// Sufijos genéricos frecuentes -- si el último segmento del dominio es uno de
// estos, NO se intenta resolver (aunque coincida por casualidad con un ccTLD
// real, como .co=Colombia o .ai=Anguila, que en la práctica casi siempre se
// usan como dominio "de marca" y no como señal de país).
const GENERIC_SUFFIXES = new Set([
  'com', 'net', 'org', 'info', 'biz', 'io', 'co', 'me', 'tv', 'ai',
  'edu', 'gov', 'int', 'name', 'pro', 'xyz', 'online', 'group', 'ltd', 'inc', 'app',
])

const byEnNorm = new Map(COUNTRIES.map(c => [c.en.trim().toLowerCase(), c.label]))

// Dado un dominio (ej. "essencegp.com.au"), devuelve el label en español del
// país si el último segmento es un ccTLD reconocido y no genérico, o null.
function resolveCountryByDomain(domain) {
  if (!domain) return null
  const parts = domain.trim().toLowerCase().split('.')
  const tld = parts[parts.length - 1]
  if (!tld || GENERIC_SUFFIXES.has(tld)) return null
  const enName = CCTLD_TO_EN[tld]
  if (!enName) return null
  return byEnNorm.get(enName.toLowerCase()) || null
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

async function fetchCompanyDomains(companyIds) {
  const domainByCompany = {}
  for (let i = 0; i < companyIds.length; i += BATCH_SIZE) {
    const chunk = companyIds.slice(i, i + BATCH_SIZE)
    const { data } = await hs.post('/crm/v3/objects/companies/batch/read', {
      inputs: chunk.map(id => ({ id })),
      properties: ['domain', 'name'],
    })
    ;(data.results || []).forEach(r => {
      domainByCompany[r.id] = { domain: r.properties?.domain || '', name: r.properties?.name || '' }
    })
    process.stdout.write(`\r  Dominios de empresa leídos: ${Math.min(i + BATCH_SIZE, companyIds.length)}/${companyIds.length}…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return domainByCompany
}

async function updateDealsBatch(pairs) {
  await hs.post('/crm/v3/objects/deals/batch/update', {
    inputs: pairs.map(p => ({ id: p.dealId, properties: { bp_evento_paises: p.pais } })),
  })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto va a escribir bp_evento_paises (inferido por dominio) en los deals listados arriba.\nEscribe exactamente "LLENAR PAISES" para continuar: ', resolve)
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

  console.log('Descargando el dominio de cada empresa…')
  const domainByCompany = await fetchCompanyDomains(uniqueCompanyIds)
  console.log('')

  const toUpdate = []
  const sinEmpresa = []
  const sinDominioUtil = [] // sin dominio, o dominio generico/no reconocido

  for (const deal of deals) {
    const dealname = deal.properties?.dealname || ''
    const companyId = companyIdByDeal[deal.id]
    if (!companyId) { sinEmpresa.push({ dealId: deal.id, dealname }); continue }

    const info = domainByCompany[companyId] || {}
    const label = resolveCountryByDomain(info.domain)
    if (!label) {
      sinDominioUtil.push({ dealId: deal.id, dealname, companyId, companyName: info.name, domain: info.domain || '' })
      continue
    }

    toUpdate.push({ dealId: deal.id, pais: label, domain: info.domain })
  }

  console.log(`Listos para actualizar (país inferido por dominio): ${toUpdate.length}`)
  console.log(`Sin empresa asociada: ${sinEmpresa.length}`)
  console.log(`Sin dominio útil (vacío, genérico o ccTLD fuera del catálogo): ${sinDominioUtil.length}`)

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true })
  fs.writeFileSync(REPORT_FILE, JSON.stringify({
    generadoEn: new Date().toISOString(),
    evento: ACTIVE_EVENT,
    totalSinPais: deals.length,
    resueltosEstaCorrida: toUpdate.length,
    sinEmpresa,
    sinDominioUtil,
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
  console.log(`\n\n✅ Listo. ${done} deals con bp_evento_paises actualizado (inferido por dominio).`)
  console.log(`   Quedan pendientes de revisión manual: ${sinEmpresa.length + sinDominioUtil.length} (ver ${REPORT_FILE})`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
