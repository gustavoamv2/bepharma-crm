// Script de un solo uso: importa la hoja MOVIMIENTOS_DEAL (Gracie) a HubSpot
// como Notas (Notes) asociadas a los Deals ya existentes.
//
// POR QUE ESTE SCRIPT Y NO EL IMPORTADOR NATIVO DE HUBSPOT:
// El importador nativo, al mapear la columna "dealname", la trato como la
// propiedad propia "Nombre del negocio" (crear/actualizar Negocios) en vez de
// usarla solo para ASOCIAR la nota a un Deal ya existente -- por eso pedia
// propiedades obligatorias de Negocio (pipeline, etapa) que esta hoja no
// tiene, y bloqueaba el import ("No se pueden importar Negocios..."). Ese
// bloqueo es una validacion, no crea nada.
//
// Este script crea las notas via API directamente, asociandolas al Deal
// correcto (nombre + dominio de empresa para desambiguar duplicados), sin
// tocar ninguna propiedad de Deal.
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/import-movimientos-notes-gracie.js --dry-run
//     -> solo hace matching contra los Deals reales y cuenta, no crea nada
//   node api/scripts/import-movimientos-notes-gracie.js --confirm
//     -> pide escribir "IMPORTAR NOTAS" y crea las notas de verdad
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN) y los
// movimientos desde api/scripts/data/movimientos_gracie.json (ya incluido).

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
  : path.join(__dirname, 'data', 'movimientos_gracie.json')

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200

// Owner de Gracie (ver mapa de owners en memoria del proyecto BePharma).
// Si este script se reusa para otro operador, cambiar este ID.
const OPERATOR_OWNER_ID = '93771979' // Gracie
const NOTE_TO_DEAL_ASSOCIATION_TYPE_ID = 214 // confirmado en bepharma-crm/api/server.js

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchCompanyDomains() {
  const map = new Map()
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/companies', {
      params: { limit: 100, properties: 'domain', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      if (r.properties.domain) map.set(r.id, r.properties.domain.trim().toLowerCase())
    }
    process.stdout.write(`\r  Empresas leidas: ${map.size}…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return map
}

async function fetchDealIndex(companyDomains) {
  const byNameAndDomain = new Map()
  const nameCount = new Map()
  const byNameOnly = new Map()
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/deals', {
      params: { limit: 100, properties: 'dealname', associations: 'companies', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      const name = (r.properties.dealname || '').trim()
      if (!name) continue
      nameCount.set(name, (nameCount.get(name) || 0) + 1)
      byNameOnly.set(name, r.id)
      const compAssoc = r.associations?.companies?.results?.[0]
      if (compAssoc) {
        const domain = companyDomains.get(compAssoc.id)
        if (domain) byNameAndDomain.set(`${name}||${domain}`, r.id)
      }
    }
    process.stdout.write(`\r  Deals leidos: ${nameCount.size} nombres unicos…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return { byNameAndDomain, nameCount, byNameOnly }
}

function resolveDealId(mov, index) {
  const name = (mov.dealname || '').trim()
  const domain = (mov.associatedcompanydomain || '').trim().toLowerCase()
  if (domain) {
    const key = `${name}||${domain}`
    if (index.byNameAndDomain.has(key)) return { id: index.byNameAndDomain.get(key), ambiguous: false }
  }
  const count = index.nameCount.get(name) || 0
  if (count === 1) return { id: index.byNameOnly.get(name), ambiguous: false }
  if (count === 0) return { id: null, ambiguous: false }
  return { id: null, ambiguous: true }
}

function toHsTimestamp(fecha) {
  if (!fecha) return null
  const m = String(fecha).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const hh = h || '12'
  const mm = mi || '00'
  return `${y}-${mo}-${d}T${hh}:${mm}:00Z`
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}

async function createNoteBatch(items) {
  const inputs = items.map(item => ({
    properties: {
      hs_note_body: item.hs_note_body,
      hs_timestamp: item.timestamp,
      hubspot_owner_id: OPERATOR_OWNER_ID,
    },
    associations: [{
      to: { id: item.dealId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_DEAL_ASSOCIATION_TYPE_ID }],
    }],
  }))
  await hs.post('/crm/v3/objects/notes/batch/create', { inputs })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto crea notas nuevas en HubSpot asociadas a los deals existentes.\nEscribe exactamente "IMPORTAR NOTAS" para continuar: ', resolve)
  })
  rl.close()
  return answer.trim() === 'IMPORTAR NOTAS'
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ No se encontró el archivo de datos: ${DATA_FILE}`)
    process.exit(1)
  }
  const movimientos = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  console.log(`Movimientos en el archivo: ${movimientos.length}`)
  console.log(DRY_RUN ? 'Modo: --dry-run (solo matching, no crea nada)\n' : 'Modo: IMPORTACION REAL\n')

  console.log('Descargando dominios de Empresas…')
  const companyDomains = await fetchCompanyDomains()
  console.log('Descargando lista de Deals existentes (con su empresa asociada)…')
  const index = await fetchDealIndex(companyDomains)
  console.log(`Total deals en HubSpot: ${[...index.nameCount.values()].reduce((a, b) => a + b, 0)} (${index.nameCount.size} nombres unicos)\n`)

  const matched = []
  const sinDeal = []
  const ambiguos = []
  let sinFecha = 0

  for (const mov of movimientos) {
    const { id: dealId, ambiguous } = resolveDealId(mov, index)
    if (ambiguous) {
      ambiguos.push(mov.dealname)
      continue
    }
    if (!dealId) {
      sinDeal.push(mov.dealname)
      continue
    }
    const ts = toHsTimestamp(mov.hs_timestamp) || nowIso()
    if (!mov.hs_timestamp) sinFecha++
    matched.push({
      dealId,
      hs_note_body: mov.hs_note_body,
      timestamp: ts,
    })
  }

  console.log(`Movimientos con deal encontrado (sin ambiguedad): ${matched.length}`)
  console.log(`Movimientos SIN deal encontrado (nombre no coincide): ${sinDeal.length}`)
  console.log(`Movimientos AMBIGUOS (nombre duplicado en HubSpot, sin dominio para desempatar): ${ambiguos.length}`)
  console.log(`Movimientos sin fecha detectada (se usara fecha de hoy): ${sinFecha}`)

  if (sinDeal.length > 0) {
    console.log('\nEjemplos de dealname sin match (revisar si el deal existe con otro nombre):')
    ;[...new Set(sinDeal)].slice(0, 10).forEach(n => console.log('  -', n))
  }
  if (ambiguos.length > 0) {
    console.log('\nEmpresas duplicadas en HubSpot (mismo nombre de deal, revisar y fusionar antes de reintentar):')
    ;[...new Set(ambiguos)].forEach(n => console.log('  -', n))
  }

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run activo: no se creó ninguna nota. Corre con --confirm para crearlas de verdad.')
    return
  }

  if (matched.length === 0) {
    console.log('\n✅ Nada que importar.')
    return
  }

  const ok = await confirmPhrase()
  if (!ok) {
    console.log('❌ Cancelado — no se creó ninguna nota.')
    return
  }

  console.log('\nCreando notas en lotes de 100…')
  let done = 0
  for (let i = 0; i < matched.length; i += BATCH_SIZE) {
    const chunk = matched.slice(i, i + BATCH_SIZE)
    try {
      await createNoteBatch(chunk)
    } catch (e) {
      console.error(`\n❌ Error en lote ${i / BATCH_SIZE + 1}:`, e.response?.data || e.message)
      console.error('   Continuando con el siguiente lote…')
    }
    done += chunk.length
    process.stdout.write(`\r  ${done}/${matched.length} notas procesadas…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log(`\n\n✅ Listo. ${done} notas creadas y asociadas a sus deals.`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
