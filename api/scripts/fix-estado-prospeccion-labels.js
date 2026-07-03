// Script de un solo uso: corrige las etiquetas (labels) de las opciones de la
// propiedad "bp_estado_prospeccion" (Estado de prospección) en el objeto Deal.
//
// Actualmente en HubSpot los labels están sin mayúsculas/tildes correctas
// (ej. "En depuracion" en vez de "En Depuración"). Esto afecta todo lo que
// muestra el label de esta propiedad: reportes, el campo en la ficha del
// deal, y cualquier vista/lista (ej. "Todos los Eventos") que muestre la
// columna "Estado".
//
// Cómo correrlo (una sola vez, desde tu máquina):
//   cd bepharma-crm
//   node ../fix-estado-prospeccion-labels.js
//   (o copialo primero a api/scripts/ y corre desde ahí)
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

const CORRECT_LABELS = {
  nueva: 'Nueva',
  en_depuracion: 'En Depuración',
  en_enriquecimiento: 'En Enriquecimiento',
  contacto_enviado: 'Contacto Enviado',
  en_seguimiento: 'En Seguimiento',
  confirmada: 'Confirmada',
  no_participa: 'No Participa',
}

async function main() {
  const { data: prop } = await hs.get(`/crm/v3/properties/${OBJECT_TYPE}/${PROPERTY_NAME}`)

  console.log('Labels actuales:')
  prop.options.forEach(o => console.log(`  ${o.value} -> "${o.label}"`))

  const newOptions = prop.options.map(o => ({
    ...o,
    label: CORRECT_LABELS[o.value] || o.label,
  }))

  await hs.patch(`/crm/v3/properties/${OBJECT_TYPE}/${PROPERTY_NAME}`, {
    options: newOptions,
  })

  console.log('\n✅ Labels corregidos:')
  newOptions.forEach(o => console.log(`  ${o.value} -> "${o.label}"`))
}

main().catch(e => {
  console.error('❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
