// Script de un solo uso: renombra en HubSpot el label de la opción
// "contacto_enviado" de la propiedad "bp_estado_prospeccion" (objeto Deal)
// de "Contacto Enviado" a "Por Contactar".
//
// Contexto (02-jul-2026): se redefinió el significado de esta etapa — ya no
// es "ya se envió un contacto", sino "la empresa ya tiene suficientes datos
// de contacto (3+, o 2+ contactos con teléfono y email) y está lista para
// que un operador la contacte". El value interno en HubSpot sigue siendo
// "contacto_enviado" (no se tocó, para no romper reportes/filtros/Make.com
// existentes) — solo cambia el texto visible.
//
// El CRM propio (bepharma-crm) ya muestra "Por Contactar" en todas sus
// pantallas independientemente de este script — esto es solo para que el
// label coincida también dentro de HubSpot nativo (vistas, reportes, etc).
//
// Cómo correrlo (una sola vez, desde tu máquina):
//   cd bepharma-crm
//   node api/scripts/rename-stage-por-contactar.js
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN).

require('dotenv').config()
const axios = require('axios')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('❌ No se encontró HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const OBJECT_TYPE = 'deals'
const PROPERTY_NAME = 'bp_estado_prospeccion'
const RENAME = { contacto_enviado: 'Por Contactar' }

async function main() {
  const { data: prop } = await hs.get(`/crm/v3/properties/${OBJECT_TYPE}/${PROPERTY_NAME}`)

  console.log('Labels actuales:')
  prop.options.forEach(o => console.log(`  ${o.value} -> "${o.label}"`))

  const newOptions = prop.options.map(o => ({
    ...o,
    label: RENAME[o.value] || o.label,
  }))

  await hs.patch(`/crm/v3/properties/${OBJECT_TYPE}/${PROPERTY_NAME}`, {
    options: newOptions,
  })

  console.log('\n✅ Labels actualizados:')
  newOptions.forEach(o => console.log(`  ${o.value} -> "${o.label}"`))
}

main().catch(e => {
  console.error('❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
