// Script de backfill: recalcula la etapa automática (Nueva/En Depuración/
// En Enriquecimiento/Por Contactar) de TODOS los deals que estén hoy en una
// etapa automática o sin etapa — misma lógica que el botón de Admin
// ("Recalcular etapas automáticas"), reutilizando el mismo servicio
// (api/services/autoStage.service.js) para no duplicar la regla de negocio.
//
// Por qué existe este script y no basta con el botón (descubierto 03-jul-2026):
// el botón corre como una función serverless de Vercel y procesa las
// empresas una por una, secuencial. Con miles de empresas nuevas (ej. el
// import masivo de BEPH-2026-09 con 4,935 deals) la ejecución total toma
// varios minutos — muy por encima del timeout de la función (10-60s, sin
// `maxDuration` configurado). El botón se corta a medio camino y, como
// siempre reprocesa en el mismo orden, nunca avanza más allá del primer
// grupo (~500 deals). Este script corre desde tu máquina sin ese límite.
//
// Nota: los deals SIN ninguna empresa asociada no se pueden clasificar acá
// (no hay de dónde sacar teléfono/email) — esos se resuelven aparte
// arreglando la asociación Deal<->Company primero (ver
// api/scripts/fix-deal-company-associations.js).
//
// Cómo correrlo (desde tu máquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/recompute-auto-stages.js --dry-run
//   node api/scripts/recompute-auto-stages.js --confirm
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN).

require('dotenv').config()
const readline = require('readline')

const { hs } = require('../repositories/hubspot.repository')
const { AUTO_STAGE_KEYS } = require('../config/hubspotProperties')
const { recomputeDealStagesForCompany } = require('../services/autoStage.service')

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 150
const CONCURRENCY = 5 // empresas en paralelo -- hs ya reintenta automático en 429

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchDealsPendientes() {
  const filterGroups = [
    { filters: [{ propertyName: 'bp_estado_prospeccion', operator: 'IN', values: AUTO_STAGE_KEYS }] },
    { filters: [{ propertyName: 'bp_estado_prospeccion', operator: 'NOT_HAS_PROPERTY' }] },
  ]
  let allDeals = []
  let after
  while (true) {
    const r = await hs.post('/crm/v3/objects/deals/search', {
      filterGroups, limit: 100, after, properties: ['dealname'],
    })
    allDeals.push(...(r.data.results || []))
    process.stdout.write(`\r  Deals pendientes leídos: ${allDeals.length}…`)
    after = r.data.paging?.next?.after
    if (!after) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return allDeals
}

async function resolveCompanyIdsByDeal(allDeals) {
  const companyIdByDeal = {}
  let sinEmpresa = 0
  for (let i = 0; i < allDeals.length; i += BATCH_SIZE) {
    const chunk = allDeals.slice(i, i + BATCH_SIZE)
    const r = await hs.post('/crm/v4/associations/deals/companies/batch/read', {
      inputs: chunk.map(d => ({ id: d.id })),
    })
    ;(r.data.results || []).forEach(row => {
      const first = row.to?.[0]?.toObjectId
      if (first) companyIdByDeal[row.from.id] = String(first)
    })
    process.stdout.write(`\r  Empresas resueltas: ${i + chunk.length}/${allDeals.length}…`)
    await sleep(REQUEST_DELAY_MS)
  }
  sinEmpresa = allDeals.filter(d => !companyIdByDeal[d.id]).length
  console.log('')
  return { companyIdByDeal, sinEmpresa }
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto va a actualizar bp_estado_prospeccion en HubSpot para todas las empresas listadas arriba.\nEscribe exactamente "RECALCULAR ETAPAS" para continuar: ', resolve)
  })
  rl.close()
  return answer.trim() === 'RECALCULAR ETAPAS'
}

// Pool simple de concurrencia -- procesa `items` con hasta `limit` a la vez.
async function runWithConcurrency(items, limit, worker) {
  const results = []
  let i = 0
  async function next() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
  return results
}

async function main() {
  console.log(DRY_RUN ? 'Modo: --dry-run (calcula pero NO escribe nada en HubSpot)\n' : 'Modo: ESCRITURA REAL\n')

  console.log('Buscando deals sin etapa o en etapa automática…')
  const allDeals = await fetchDealsPendientes()
  console.log(`Total de deals pendientes de clasificar: ${allDeals.length}\n`)

  if (allDeals.length === 0) {
    console.log('✅ Nada pendiente.')
    return
  }

  console.log('Resolviendo la empresa asociada a cada deal…')
  const { companyIdByDeal, sinEmpresa } = await resolveCompanyIdsByDeal(allDeals)
  const uniqueCompanyIds = [...new Set(Object.values(companyIdByDeal))]
  console.log(`Empresas únicas a procesar: ${uniqueCompanyIds.length}`)
  console.log(`Deals sin ninguna empresa asociada (no se pueden clasificar acá): ${sinEmpresa}\n`)

  if (DRY_RUN) {
    console.log('🔍 --dry-run: no se escribe nada. Corre con --confirm para aplicar los cambios.')
  } else {
    const ok = await confirmPhrase()
    if (!ok) {
      console.log('❌ Cancelado — no se escribió nada.')
      return
    }
  }

  console.log(`\nProcesando ${uniqueCompanyIds.length} empresas (${CONCURRENCY} en paralelo)…`)
  let done = 0
  let totalDealsActualizados = 0
  const companiesConError = []

  const results = await runWithConcurrency(uniqueCompanyIds, CONCURRENCY, async (cid) => {
    const r = await recomputeDealStagesForCompany(cid, { dryRun: DRY_RUN })
    done++
    if (r?.error) companiesConError.push(cid)
    else totalDealsActualizados += r?.updatedDeals?.length || 0
    process.stdout.write(`\r  Empresas procesadas: ${done}/${uniqueCompanyIds.length} · deals ${DRY_RUN ? 'a actualizar' : 'actualizados'}: ${totalDealsActualizados} · errores: ${companiesConError.length}…`)
    return r
  })

  console.log('\n')
  console.log(`✅ Listo. Empresas procesadas: ${uniqueCompanyIds.length}`)
  console.log(`   Deals ${DRY_RUN ? 'que se actualizarían' : 'actualizados'}: ${totalDealsActualizados}`)
  console.log(`   Empresas con error (revisar logs arriba): ${companiesConError.length}`)
  if (companiesConError.length) {
    console.log(`   IDs con error: ${companiesConError.join(', ')}`)
  }
  if (sinEmpresa > 0) {
    console.log(`\n⚠️  ${sinEmpresa} deals siguen sin empresa asociada y no se tocaron — ver api/scripts/fix-deal-company-associations.js`)
  }
  void results
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
