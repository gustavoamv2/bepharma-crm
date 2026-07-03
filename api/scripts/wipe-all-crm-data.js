// Script de un solo uso: BORRA TODOS los registros de Empresas, Contactos y
// Deals en el portal de HubSpot para hacer una migración limpia (03-jul-2026).
//
// ADVERTENCIA: esto borra TODO — no filtra por evento, zona ni operador.
// Incluye los 3 registros de control de evento (BEPH-2026-09, BEPH-2027-03,
// BEPH-2027-09) si el tipo "companies" está en el alcance — recuérdalo,
// habrá que recrearlos después para que el escenario Make "Creación de
// evento" (5393788) siga funcionando.
//
// Los registros van a la papelera de HubSpot (recuperables ~90 días desde
// Configuración > Papelera), pero desaparecen de inmediato de vistas,
// reportes y del pipeline.
//
// Cómo correrlo (desde tu máquina, con internet real — el sandbox de Claude
// no tiene acceso a api.hubapi.com, este script no se puede correr ahí):
//   cd bepharma-crm
//   node api/scripts/wipe-all-crm-data.js --dry-run
//     → solo cuenta y lista, no borra nada
//   node api/scripts/wipe-all-crm-data.js --confirm
//     → te pide escribir "BORRAR TODO" y luego borra en serio
//
// Opcional: limitar a ciertos objetos con --only=deals,contacts,companies
// (por defecto borra los tres, en ese orden: deals → contactos → empresas).
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN). El Private
// App necesita scopes de escritura sobre companies/contacts/deals (el mismo
// token que ya usa el CRM para crear/editar sirve para borrar).

require('dotenv').config()
const axios = require('axios')
const readline = require('readline')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('❌ No se encontró HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DRY_RUN = !process.argv.includes('--confirm')
const onlyArg = process.argv.find(a => a.startsWith('--only='))
const OBJECT_ORDER = ['deals', 'contacts', 'companies']
const targets = onlyArg
  ? onlyArg.split('=')[1].split(',').map(s => s.trim().toLowerCase()).filter(t => OBJECT_ORDER.includes(t))
  : OBJECT_ORDER

const LABELS = { deals: 'Deals', contacts: 'Contactos', companies: 'Empresas' }
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 150

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchAllIds(objectType) {
  const ids = []
  let after
  let page = 0
  while (true) {
    page++
    const { data } = await hs.get(`/crm/v3/objects/${objectType}`, {
      params: { limit: BATCH_SIZE, ...(after ? { after } : {}) },
    })
    const results = data.results || []
    ids.push(...results.map(r => r.id))
    process.stdout.write(`\r  ${LABELS[objectType]} — página ${page}: ${ids.length} encontrados hasta ahora…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return ids
}

async function archiveBatch(objectType, ids) {
  await hs.post(`/crm/v3/objects/${objectType}/batch/archive`, {
    inputs: ids.map(id => ({ id })),
  })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question(
      '\n⚠️  Esto borra TODOS los registros listados arriba, sin deshacer fácil.\n' +
      'Escribe exactamente "BORRAR TODO" para continuar: ',
      resolve
    )
  })
  rl.close()
  return answer.trim() === 'BORRAR TODO'
}

async function main() {
  console.log(`Objetos a procesar: ${targets.map(t => LABELS[t]).join(', ')}`)
  console.log(DRY_RUN ? 'Modo: --dry-run (solo cuenta, no borra)\n' : 'Modo: BORRADO REAL\n')

  const idsByType = {}
  for (const objectType of targets) {
    console.log(`Buscando ${LABELS[objectType]}…`)
    idsByType[objectType] = await fetchAllIds(objectType)
    console.log(`  Total ${LABELS[objectType]}: ${idsByType[objectType].length}\n`)
  }

  const totalCount = Object.values(idsByType).reduce((a, b) => a + b.length, 0)
  if (totalCount === 0) {
    console.log('✅ No hay nada que borrar.')
    return
  }

  if (DRY_RUN) {
    console.log('🔍 --dry-run activo: no se borró nada. Corre con --confirm para borrar de verdad.')
    return
  }

  const ok = await confirmPhrase()
  if (!ok) {
    console.log('❌ Cancelado — no se borró nada.')
    return
  }

  for (const objectType of targets) {
    const ids = idsByType[objectType]
    if (ids.length === 0) continue
    console.log(`\nBorrando ${LABELS[objectType]} (${ids.length})…`)
    let done = 0
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE)
      await archiveBatch(objectType, chunk)
      done += chunk.length
      process.stdout.write(`\r  ${done}/${ids.length} borrados…`)
      await sleep(REQUEST_DELAY_MS)
    }
    console.log('')
  }

  console.log(`\n✅ Listo. ${totalCount} registros borrados (movidos a la papelera de HubSpot).`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
