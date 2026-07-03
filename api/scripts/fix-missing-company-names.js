// Script de un solo uso: completa la propiedad "name" (Nombre de la empresa)
// en Empresas de HubSpot que quedaron SIN NOMBRE tras los distintos imports,
// usando como fuente el nombre que sí quedó guardado en el campo "Company
// Name" (propiedad "company", texto libre) de al menos un Contacto asociado
// a esa empresa.
//
// Por que existen estas empresas sin nombre: en varios operadores, algunas
// filas del Excel fuente traian el nombre de empresa en la columna de
// contacto pero la celda "Empresa" quedo vacia (o el import nativo no la
// tomo) -- la empresa se creo igual (por la asociacion), pero sin "name".
//
// Este script NO inventa nada: solo usa nombres que ya estan en HubSpot (en
// el contacto), y antes de escribir vuelve a leer cada empresa para
// confirmar que su "name" SIGUE vacio (evita pisar un nombre que alguien ya
// haya completado a mano entre la exportacion del listado y la corrida del
// script).
//
// Los 4 casos AMBIGUOS (empresa con 2 contactos que traen nombres DISTINTOS
// en su campo "company") se omiten siempre -- requieren decision manual de
// Gustavo, ver columna "nombresCandidatos" en el archivo de datos.
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/fix-missing-company-names.js --dry-run
//   node api/scripts/fix-missing-company-names.js --confirm
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN) y los datos
// desde api/scripts/data/empresas_sin_nombre.json (ya incluido, exportado
// via query_crm_data: empresas con name vacio que tienen un contacto
// asociado con su propio campo "company" no vacio).

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
  : path.join(__dirname, 'data', 'empresas_sin_nombre.json')

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchCurrentNames(companyIds) {
  // batch/read para confirmar el estado ACTUAL de "name" justo antes de escribir
  const map = new Map()
  for (let i = 0; i < companyIds.length; i += BATCH_SIZE) {
    const chunk = companyIds.slice(i, i + BATCH_SIZE)
    const { data } = await hs.post('/crm/v3/objects/companies/batch/read', {
      properties: ['name'],
      inputs: chunk.map(id => ({ id })),
    })
    for (const r of data.results || []) {
      map.set(r.id, (r.properties.name || '').trim())
    }
    process.stdout.write(`\r  Empresas releidas: ${map.size}/${companyIds.length}…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return map
}

async function updateNamesBatch(pairs) {
  const inputs = pairs.map(p => ({
    id: p.companyId,
    properties: { name: p.nombreSugerido },
  }))
  await hs.post('/crm/v3/objects/companies/batch/update', { inputs })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto va a escribir la propiedad "name" en Empresas existentes en HubSpot.\nEscribe exactamente "CORREGIR NOMBRES" para continuar: ', resolve)
  })
  rl.close()
  return answer.trim() === 'CORREGIR NOMBRES'
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ No se encontró el archivo de datos: ${DATA_FILE}`)
    process.exit(1)
  }
  const rows = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  console.log(`Empresas en el archivo fuente: ${rows.length}`)
  console.log(DRY_RUN ? 'Modo: --dry-run (solo verifica, no escribe nada)\n' : 'Modo: ESCRITURA REAL\n')

  const ambiguous = rows.filter(r => r.ambiguous)
  const candidates = rows.filter(r => !r.ambiguous)

  console.log(`Ambiguas (2+ nombres distintos sugeridos, se omiten siempre): ${ambiguous.length}`)
  console.log(`Candidatas a corregir: ${candidates.length}\n`)

  console.log('Releyendo el estado actual de "name" en HubSpot antes de decidir…')
  const currentNames = await fetchCurrentNames(candidates.map(c => c.companyId))

  const toUpdate = []
  let yaTieneNombre = 0
  let noEncontrada = 0

  for (const c of candidates) {
    const current = currentNames.get(c.companyId)
    if (current === undefined) { noEncontrada++; continue }
    if (current !== '') { yaTieneNombre++; continue }
    toUpdate.push(c)
  }

  console.log(`\nListas para corregir (name sigue vacio en HubSpot): ${toUpdate.length}`)
  console.log(`Ya tienen nombre (alguien lo completo mientras tanto, se omiten): ${yaTieneNombre}`)
  console.log(`No encontradas por ID (empresa borrada/fusionada, se omiten): ${noEncontrada}`)

  if (ambiguous.length > 0) {
    console.log('\nEmpresas AMBIGUAS que requieren revision manual (ver nombresCandidatos en el archivo de datos):')
    ambiguous.forEach(a => console.log(`  - ${a.companyId}: ${a.nombresCandidatos.join(' | ')}`))
  }

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run activo: no se escribió ningún nombre. Corre con --confirm para escribirlos de verdad.')
    return
  }

  if (toUpdate.length === 0) {
    console.log('\n✅ Nada que corregir.')
    return
  }

  const ok = await confirmPhrase()
  if (!ok) {
    console.log('❌ Cancelado — no se escribió ningún nombre.')
    return
  }

  console.log('\nActualizando en lotes de 100…')
  let done = 0
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE)
    try {
      await updateNamesBatch(chunk)
    } catch (e) {
      console.error(`\n❌ Error en lote ${i / BATCH_SIZE + 1}:`, e.response?.data || e.message)
      console.error('   Continuando con el siguiente lote…')
    }
    done += chunk.length
    process.stdout.write(`\r  ${done}/${toUpdate.length} empresas actualizadas…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log(`\n\n✅ Listo. ${done} empresas actualizadas con su nombre.`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
