// Script de un solo uso: crea la propiedad personalizada "bp_notas_contacto"
// (texto largo / textarea) en el objeto Contacto de HubSpot.
//
// Uso: anotaciones libres del operador sobre el contacto (no confundir con
// "bp_notas_movilidad_contacto", que es específico del historial de cambio
// de empresa/rotación).
//
// Cómo correrlo (una sola vez, desde tu máquina — el sandbox de Claude no
// tiene salida a internet hacia api.hubapi.com):
//   1. cd bepharma-crm
//   2. node api/scripts/create-notas-contacto-property.js
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN), igual que el
// resto del backend.

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

const PROPERTY = {
  name: 'bp_notas_contacto',
  label: 'Anotaciones / Notas del contacto',
  type: 'string',
  fieldType: 'textarea',
  groupName: 'contactinformation',
  description: 'Anotaciones libres del operador sobre este contacto (preferencias, observaciones de llamadas, etc.).',
}

async function main() {
  try {
    await hs.get(`/crm/v3/properties/contacts/${PROPERTY.name}`)
    console.log(`✅ La propiedad "${PROPERTY.name}" ya existe en HubSpot. Nada que hacer.`)
    return
  } catch (e) {
    if (e.response?.status !== 404) {
      console.error('❌ Error verificando la propiedad:', e.response?.data || e.message)
      process.exit(1)
    }
  }

  try {
    await hs.post('/crm/v3/properties/contacts', PROPERTY)
    console.log(`✅ Propiedad "${PROPERTY.name}" creada correctamente en el objeto Contacto.`)
  } catch (e) {
    console.error('❌ Error creando la propiedad:', e.response?.data || e.message)
    process.exit(1)
  }
}

main()
