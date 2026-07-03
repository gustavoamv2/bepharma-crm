// Script de un solo uso: archiva en HubSpot los registros de "calls" basura
// generados por el marcador automatico de la integracion nativa
// "Zadarma Calling, SMS, AI" (hs_call_status = QUEUED, nunca conectan).
//
// IMPORTANTE: antes de correr esto, desactiva/revisa esa integracion en
// HubSpot (Configuracion > Integraciones > Apps conectadas) — si sigue
// activa, va a seguir generando llamadas nuevas y este cleanup se vuelve
// a llenar.
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/cleanup-junk-calls.js
//   (agrega --dry-run para solo contar/listar sin borrar nada)
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN).

require('dotenv').config()
const axios = require('axios')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('❌ No se encontró HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DRY_RUN = process.argv.includes('--dry-run')

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const BATCH_SIZE = 100

async function fetchAllJunkCallIds() {
  const ids = []
  let after = undefined
  let page = 0
  while (true) {
    page++
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: 'hs_call_status', operator: 'EQ', value: 'QUEUED' },
          { propertyName: 'hs_call_source', operator: 'EQ', value: 'INTEGRATIONS_PLATFORM' },
        ],
      }],
      properties: ['hs_call_status'],
      limit: BATCH_SIZE,
      ...(after ? { after } : {}),
    }
    const { data } = await hs.post('/crm/v3/objects/calls/search', body)
    const results = data.results || []
    ids.push(...results.map(r => r.id))
    process.stdout.write(`\r  Página ${page}: ${ids.length} encontradas hasta ahora (total reportado por HubSpot: ${data.total})…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
  }
  console.log('')
  return ids
}

async function archiveBatch(ids) {
  await hs.post('/crm/v3/objects/calls/batch/archive', {
    inputs: ids.map(id => ({ id })),
  })
}

async function main() {
  console.log('Buscando llamadas basura (QUEUED + INTEGRATIONS_PLATFORM)…')
  const ids = await fetchAllJunkCallIds()
  console.log(`\nEncontradas: ${ids.length} llamadas basura.`)

  if (ids.length === 0) {
    console.log('✅ Nada que limpiar.')
    return
  }

  if (DRY_RUN) {
    console.log('🔍 --dry-run activo: no se borró nada. Corre sin --dry-run para archivarlas.')
    return
  }

  console.log('Archivando en lotes de 100…')
  let done = 0
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE)
    await archiveBatch(chunk)
    done += chunk.length
    process.stdout.write(`\r  ${done}/${ids.length} archivadas…`)
  }
  console.log(`\n✅ Listo. ${done} llamadas basura archivadas en HubSpot.`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
