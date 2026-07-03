// Script de un solo uso: asocia los Deals importados (Angel) con su Empresa
// correspondiente. Se detecto que los 1,112 deals quedaron SIN ninguna
// asociacion a Empresa (confirmado con la API: COUNT(*) FROM DEAL WHERE
// associations.COMPANY IS NULL = 1112) -- el paso de "asociar por dominio"
// del import nativo de Deals no se aplico.
//
// Este script NO toca propiedades de los deals, solo crea la asociacion
// Deal <-> Company via la API v4 de asociaciones (idempotente: si ya existe
// la asociacion, no la duplica).
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/fix-deal-company-associations.js --dry-run
//   node api/scripts/fix-deal-company-associations.js --confirm
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN) y el mapeo
// deal->dominio desde api/scripts/data/deals_empresa_map.json (ya incluido,
// exportado de la hoja DEALS del Excel de importacion de Angel).
//
// Los 8 deals con nombre duplicado en HubSpot (empresas que quedaron
// duplicadas, ver conversacion) se omiten aqui a proposito -- corrigelos
// DESPUES de fusionar esas empresas/deals con el Merge nativo de HubSpot.

require('dotenv').config()
const axios = require('axios')
const readline = require('readline')
const path = require('path')
const fs = require('fs')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('No se encontro HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DATA_FILE = process.argv.find(a => a.startsWith('--data='))
  ? process.argv.find(a => a.startsWith('--data=')).split('=')[1]
  : path.join(__dirname, 'data', 'deals_empresa_map.json')

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200
const DEAL_TO_COMPANY_ASSOCIATION_TYPE_ID = 5 // confirmado en el escenario Make "Creacion de evento"

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchCompanyDomainToId() {
  const map = new Map()
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/companies', {
      params: { limit: 100, properties: 'domain', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      if (r.properties.domain) map.set(r.properties.domain.trim().toLowerCase(), r.id)
    }
    process.stdout.write(`\r  Empresas leidas: ${map.size}…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return map
}

async function fetchDealNameIndex() {
  const nameCount = new Map()
  const byNameOnly = new Map()
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/deals', {
      params: { limit: 100, properties: 'dealname', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      const name = (r.properties.dealname || '').trim()
      if (!name) continue
      nameCount.set(name, (nameCount.get(name) || 0) + 1)
      byNameOnly.set(name, r.id)
    }
    process.stdout.write(`\r  Deals leidos: ${nameCount.size} nombres unicos…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return { nameCount, byNameOnly }
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
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ No se encontró el archivo de datos: ${DATA_FILE}`)
    process.exit(1)
  }
  const rows = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  console.log(`Deals en el archivo fuente: ${rows.length}`)
  console.log(DRY_RUN ? 'Modo: --dry-run (solo matching, no asocia nada)\n' : 'Modo: ASOCIACION REAL\n')

  console.log('Descargando dominios de Empresas…')
  const companyByDomain = await fetchCompanyDomainToId()
  console.log(`Total empresas con dominio: ${companyByDomain.size}\n`)

  console.log('Descargando lista de Deals existentes…')
  const dealIndex = await fetchDealNameIndex()
  console.log('')

  const toAssociate = []
  let sinDominio = 0
  let dominioSinEmpresa = 0
  let nombreAmbiguo = 0
  let dealNoEncontrado = 0

  for (const row of rows) {
    const domain = (row.domain || '').trim().toLowerCase()
    if (!domain) { sinDominio++; continue }

    const companyId = companyByDomain.get(domain)
    if (!companyId) { dominioSinEmpresa++; continue }

    const name = (row.dealname || '').trim()
    const count = dealIndex.nameCount.get(name) || 0
    if (count === 0) { dealNoEncontrado++; continue }
    if (count > 1) { nombreAmbiguo++; continue } // los 8 duplicados conocidos -- resolver despues del Merge

    const dealId = dealIndex.byNameOnly.get(name)
    toAssociate.push({ dealId, companyId, dealname: name })
  }

  console.log(`Listos para asociar: ${toAssociate.length}`)
  console.log(`Sin dominio en el Excel fuente (no se puede asociar): ${sinDominio}`)
  console.log(`Dominio sin empresa correspondiente en HubSpot: ${dominioSinEmpresa}`)
  console.log(`Nombre de deal ambiguo (duplicado, pendiente de Merge): ${nombreAmbiguo}`)
  console.log(`Deal no encontrado por nombre: ${dealNoEncontrado}`)

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run activo: no se asoció nada. Corre con --confirm para asociar de verdad.')
    return
  }

  if (toAssociate.length === 0) {
    console.log('\n✅ Nada que asociar.')
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
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
