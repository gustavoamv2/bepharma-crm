// Script de un solo uso: asocia los Deals importados (Sara) con su Empresa
// correspondiente. En el batch de Angel se detecto que el import nativo de
// Deals NO aplico el paso de "asociar por dominio" (los 1,112 deals quedaron
// sin ninguna asociacion a Empresa) -- correr este script despues de importar
// los Deals de Carlos para verificar/corregir lo mismo, en vez de asumir que
// el import nativo lo hizo bien.
//
// Este script NO toca propiedades de los deals, solo crea la asociacion
// Deal <-> Company via la API v4 de asociaciones (idempotente: si ya existe
// la asociacion, no la duplica).
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/fix-deal-company-associations-sara.js --dry-run
//   node api/scripts/fix-deal-company-associations-sara.js --confirm
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN) y el mapeo
// deal->dominio desde api/scripts/data/deals_empresa_map_sara.json (ya
// incluido, exportado de la hoja DEALS del Excel de importacion de Carlos).
//
// Los 4 deals con nombre de empresa duplicado (Organon, Biols Pharmaceuticals,
// OpenDoors Pharma, Bachem) se omiten aqui a proposito -- corregirlos
// DESPUES de fusionar esas empresas/deals con el Merge nativo de HubSpot.
//
// FIX CRITICO (03-jul-2026, detectado en el --dry-run inicial): las 971
// empresas de Sara (bp_zona='sara') quedaron con la propiedad ESTANDAR
// "domain" completamente vacia (0/971) -- en el import nativo solo se mapeo
// bp_dominio_normalizado, no domain. La primera version de este script
// matcheaba por "domain" contra TODAS las empresas del portal, así que los
// 780 "matches" que salieron en el primer dry-run eran en realidad empresas
// de OTRO operador (u otras ya existentes) que coincidian por dominio -- NO
// las empresas reales de Carlos. Se hubiera asociado cada deal de Carlos a
// la empresa equivocada. Fix: ahora se matchea por bp_dominio_normalizado
// Y se filtra SOLO a empresas con bp_zona='sara', para no cruzar nunca con
// empresas de otro operador. Si dos empresas de Sara comparten el mismo
// bp_dominio_normalizado, se marca como ambiguo y no se asocia (en vez de
// adivinar cual es la correcta).

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
  : path.join(__dirname, 'data', 'deals_empresa_map_sara.json')

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200
const DEAL_TO_COMPANY_ASSOCIATION_TYPE_ID = 5 // confirmado en el escenario Make "Creacion de evento"
const OPERATOR_ZONE = 'sara'

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchCompanyDomainToId() {
  // domain -> companyId, SOLO para empresas de bp_zona='sara' (evita
  // cruzar por error con empresas de otro operador que compartan dominio).
  // Usa bp_dominio_normalizado como fuente primaria (domain estandar quedo
  // vacio en el import nativo de Carlos); si un mismo dominio aparece en mas
  // de una empresa de Carlos, se marca ambiguo (id = null) y se omite.
  const map = new Map()
  const seenCount = new Map()
  let leidas = 0
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/companies', {
      params: { limit: 100, properties: 'domain,bp_dominio_normalizado,bp_zona', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      leidas++
      if ((r.properties.bp_zona || '').trim().toLowerCase() !== OPERATOR_ZONE) continue
      const domain = (r.properties.domain || r.properties.bp_dominio_normalizado || '').trim().toLowerCase()
      if (!domain) continue
      seenCount.set(domain, (seenCount.get(domain) || 0) + 1)
      map.set(domain, r.id)
    }
    process.stdout.write(`\r  Empresas leidas (total portal): ${leidas}, con zona=sara y dominio: ${map.size}…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  for (const [domain, count] of seenCount) {
    if (count > 1) map.set(domain, null) // ambiguo: dos empresas de Sara con el mismo dominio
  }
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
  console.log(`Total empresas con dominio (zona sara): ${companyByDomain.size}\n`)

  console.log('Descargando lista de Deals existentes…')
  const dealIndex = await fetchDealNameIndex()
  console.log('')

  const toAssociate = []
  let sinDominio = 0
  let dominioSinEmpresa = 0
  let dominioAmbiguo = 0
  let nombreAmbiguo = 0
  let dealNoEncontrado = 0

  for (const row of rows) {
    const domain = (row.domain || '').trim().toLowerCase()
    if (!domain) { sinDominio++; continue }

    const companyId = companyByDomain.get(domain)
    if (companyId === undefined) { dominioSinEmpresa++; continue }
    if (companyId === null) { dominioAmbiguo++; continue } // dos empresas de Sara comparten este dominio

    const name = (row.dealname || '').trim()
    const count = dealIndex.nameCount.get(name) || 0
    if (count === 0) { dealNoEncontrado++; continue }
    if (count > 1) { nombreAmbiguo++; continue } // los 4 duplicados conocidos -- resolver despues del Merge

    const dealId = dealIndex.byNameOnly.get(name)
    toAssociate.push({ dealId, companyId, dealname: name })
  }

  console.log(`Listos para asociar: ${toAssociate.length}`)
  console.log(`Sin dominio en el Excel fuente (no se puede asociar): ${sinDominio}`)
  console.log(`Dominio sin empresa correspondiente (zona sara) en HubSpot: ${dominioSinEmpresa}`)
  console.log(`Dominio ambiguo (2+ empresas de Sara con el mismo dominio): ${dominioAmbiguo}`)
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
