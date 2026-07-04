// Elimina (archiva) las tareas "basura" acumuladas en HubSpot: pruebas de
// desarrollo (TEST-HARDCODED, TEST-UTC-INLINE, TEST2, etc.), tareas de
// ejemplo que trae HubSpot por defecto en cualquier portal nuevo, y tareas
// generadas en ráfaga por un proceso/automatización externa (110x
// "Buscar email de empresa / contacto decisor", 55x "Crear deal para evento
// alternativo", "Callback vencido", "Enriquecimiento de contacto requerido",
// "Sin actividad +72h", y ~7 sin asunto) — ninguna de estas 222 tiene
// asociación a un deal/contacto/empresa (confirmado antes de generar esta
// lista), por eso saturaban "Tareas pendientes" en el Dashboard sin nunca
// poder completarse desde el CRM.
//
// Se dejaron INTACTAS (no están en data/junk-tasks-to-delete.json) las
// tareas que sí parecen trabajo real de un operador:
//   - Callback de seguimiento
//   - Primera llamada / contacto inicial
//   - Buscar email de contacto decisor (singular, mismo lote/segundo que las 2 anteriores)
//   - Seguimiento: Laboratorio 123 SPA (x2)
//   - Seguimiento: Frontage Laboratories, Inc. - BEPH-2026-09
//
// La lista de IDs a borrar (api/scripts/data/junk-tasks-to-delete.json) se
// armó el 04-jul-2026 vía el conector MCP de HubSpot (search_crm_objects
// sobre TASK con hs_task_status=NOT_STARTED, 228 en total) y no debe
// reusarse para otra limpieza futura sin regenerarla.
//
// HubSpot Tasks usa el endpoint de "archive" (soft-delete) via batch, igual
// que companies/contacts/deals: POST /crm/v3/objects/tasks/batch/archive
// con { inputs: [{ id }, ...] }, máximo 100 ids por request.
//
// Como correrlo (desde tu maquina, con internet real -- el sandbox no
// puede llegar a api.hubapi.com directo):
//   cd bepharma-crm
//   node api/scripts/delete-junk-tasks.js --dry-run
//   node api/scripts/delete-junk-tasks.js --confirm

require('dotenv').config()
const axios = require('axios')
const path = require('path')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('No se encontro HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const args = process.argv.slice(2)
const CONFIRM = args.includes('--confirm')

const tasks = require('./data/junk-tasks-to-delete.json')

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function main() {
  console.log(`Tareas a eliminar (archivar): ${tasks.length}`)

  const bySubject = {}
  for (const t of tasks) bySubject[t.subject] = (bySubject[t.subject] || 0) + 1
  console.log('\nDesglose:')
  Object.entries(bySubject)
    .sort((a, b) => b[1] - a[1])
    .forEach(([subj, count]) => console.log(`  ${String(count).padStart(4)}  ${subj}`))

  if (!CONFIRM) {
    console.log('\n[DRY RUN] No se elimino nada. Corre con --confirm para ejecutar.')
    return
  }

  const batches = chunk(tasks.map(t => t.id), 100)
  let ok = 0
  let failed = []

  for (const [i, batch] of batches.entries()) {
    try {
      await hs.post('/crm/v3/objects/tasks/batch/archive', {
        inputs: batch.map(id => ({ id })),
      })
      ok += batch.length
      console.log(`Batch ${i + 1}/${batches.length}: ${batch.length} archivadas OK`)
    } catch (e) {
      console.error(`Batch ${i + 1}/${batches.length} FALLO:`, e.response?.data || e.message)
      failed.push(...batch)
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\nTotal archivadas OK: ${ok}`)
  if (failed.length) {
    console.log(`Fallaron ${failed.length} ids:`, failed.join(', '))
  }
}

main().catch(e => {
  console.error('Error inesperado:', e.response?.data || e.message)
  process.exit(1)
})
