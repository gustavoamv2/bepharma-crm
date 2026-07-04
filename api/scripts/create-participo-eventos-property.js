// Script de un solo uso: crea la propiedad personalizada "bp_participo_eventos"
// (checkbox) en el objeto Empresa de HubSpot.
//
// A diferencia de "num_associated_deals" (que solo cuenta deals asociados),
// este campo es una marca MANUAL para que el operador/supervisor indique
// a criterio propio si la empresa ya participó en algún evento BePharma
// (por ejemplo, historial previo a la migración a HubSpot que no quedó
// registrado como deal).
//
// Cómo correrlo (una sola vez, desde tu máquina — el sandbox de Claude no
// tiene salida a internet hacia api.hubapi.com):
//   1. cd bepharma-crm
//   2. node api/scripts/create-participo-eventos-property.js
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
  name: 'bp_participo_eventos',
  label: 'Participó en Eventos',
  type: 'bool',
  fieldType: 'booleancheckbox',
  groupName: 'companyinformation',
  description: 'Marca manual: la empresa ya participó en algún evento BePharma (histórico o confirmado). No se calcula automáticamente a partir de los deals asociados.',
  options: [
    { label: 'No', value: 'false', displayOrder: 0, hidden: false },
    { label: 'Sí', value: 'true', displayOrder: 1, hidden: false },
  ],
}

async function main() {
  try {
    await hs.get(`/crm/v3/properties/companies/${PROPERTY.name}`)
    console.log(`✅ La propiedad "${PROPERTY.name}" ya existe en HubSpot. Nada que hacer.`)
    return
  } catch (e) {
    if (e.response?.status !== 404) {
      console.error('❌ Error verificando la propiedad:', e.response?.data || e.message)
      process.exit(1)
    }
  }

  try {
    await hs.post('/crm/v3/properties/companies', PROPERTY)
    console.log(`✅ Propiedad "${PROPERTY.name}" creada correctamente en el objeto Empresa.`)
  } catch (e) {
    console.error('❌ Error creando la propiedad:', e.response?.data || e.message)
    process.exit(1)
  }
}

main()
