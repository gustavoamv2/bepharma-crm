// Script de un solo uso: RECREA los 3 registros de control de evento
// (tipo Empresa) que se borraron con wipe-all-crm-data.js el 03-jul-2026.
//
// Estos registros no son empresas reales — son "control" que usa el
// escenario Make "BP Make - Creación de evento" (5393788) para saber qué
// evento está activo y con qué nombre/código armar los deals.
//
// AJUSTA antes de correr: las fechas y metas de abajo son placeholders.
// El código, nombre y estado de cada evento SÍ están confirmados (ver
// bepharma-crm/src/components/RecordModal.jsx → EVENTOS_PROGRAMADOS).
//
// Cómo correrlo (desde tu máquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/create-event-control-records.js --dry-run
//     → solo muestra qué se va a crear, no crea nada
//   node api/scripts/create-event-control-records.js --confirm
//     → crea los 3 registros de verdad
//
// IMPORTANTE — paso manual después de correr con --confirm:
// El escenario Make 5393788 tiene HARDCODEADO el ID viejo del registro
// BEPH-2026-09 (55534825385, ya no existe) en la URL del módulo 1
// (GET /crm/v3/objects/companies/{id}?properties=...). Hay que actualizar
// ese módulo con el ID NUEVO que este script imprime al final, o el
// escenario va a fallar con 404. Avísale a Claude el ID nuevo de
// BEPH-2026-09 para que actualice el escenario en Make, o hazlo tú a mano
// en Make.com → Escenarios → BP Make - Creación de evento → módulo 1 → URL.
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN).

require('dotenv').config()
const axios = require('axios')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('❌ No se encontró HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DRY_RUN = !process.argv.includes('--confirm')

// Convierte una fecha YYYY-MM-DD a medianoche UTC en milisegundos (formato
// que HubSpot espera para propiedades tipo "date").
function dateToHsMs(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return String(Date.UTC(y, m - 1, d))
}

// AJUSTA fechas y metas según lo que confirme Roberto/Yesenia — el código,
// nombre y estado ya están confirmados en el CRM (EVENTOS_PROGRAMADOS).
const EVENTS = [
  {
    codigo: 'BEPH-2026-09',
    nombre: 'BePharma Septiembre 2026',
    estado: 'activo', // enum válido: borrador | activo | pausado | cerrado
    fecha_inicio: '2026-09-01',
    fecha_cierre: '2026-09-30',
    meta_contactar: 1200,
    meta_confirmar: 300,
  },
  {
    codigo: 'BEPH-2027-03',
    nombre: 'BePharma Marzo 2027',
    estado: 'borrador',
    fecha_inicio: '2027-03-01',
    fecha_cierre: '2027-03-31',
    meta_contactar: 1200,
    meta_confirmar: 300,
  },
  {
    codigo: 'BEPH-2027-09',
    nombre: 'BePharma Septiembre 2027',
    estado: 'borrador',
    fecha_inicio: '2027-09-01',
    fecha_cierre: '2027-09-30',
    meta_contactar: 1200,
    meta_confirmar: 300,
  },
]

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

function buildPayload(ev) {
  return {
    properties: {
      name: ev.nombre,
      bp_evento_codigo: ev.codigo,
      bp_evento_nombre: ev.nombre,
      bp_evento_estado: ev.estado,
      bp_evento_fecha_inicio: dateToHsMs(ev.fecha_inicio),
      bp_evento_fecha_cierre: dateToHsMs(ev.fecha_cierre),
      bp_evento_meta_contactar: ev.meta_contactar,
      bp_evento_meta_confirmar: ev.meta_confirmar,
    },
  }
}

async function main() {
  console.log(`Se van a crear ${EVENTS.length} registros de control de evento:\n`)
  const inputs = EVENTS.map(buildPayload)
  inputs.forEach((input, i) => {
    console.log(`  ${i + 1}. ${input.properties.bp_evento_codigo} — ${input.properties.name} (estado: ${input.properties.bp_evento_estado})`)
  })

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run activo: no se creó nada. Revisa fechas/metas arriba y corre con --confirm.')
    return
  }

  console.log('\nCreando en HubSpot…')
  const { data } = await hs.post('/crm/v3/objects/companies/batch/create', { inputs })

  console.log('\n✅ Creados:')
  data.results.forEach(r => {
    console.log(`  ${r.properties.bp_evento_codigo} → ID ${r.id}  (${r.properties.name})`)
  })

  const activo = data.results.find(r => r.properties.bp_evento_estado === 'activo')
  if (activo) {
    console.log(`\n⚠️  Pendiente manual: actualiza el módulo 1 del escenario Make "BP Make - Creación de evento" (5393788)`)
    console.log(`   con este ID nuevo (evento activo ${activo.properties.bp_evento_codigo}): ${activo.id}`)
    console.log('   O comparte este ID en el chat para que se actualice desde ahí.')
  }
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
