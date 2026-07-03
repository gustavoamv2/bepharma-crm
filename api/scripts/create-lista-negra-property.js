// Script de un solo uso: crea la propiedad personalizada "bp_lista_negra"
// (checkbox) en el objeto Empresa de HubSpot.
//
// Cómo correrlo (una sola vez, desde tu máquina — el sandbox de Claude no
// tiene salida a internet hacia api.hubapi.com):
//   1. Copia este archivo a la carpeta bepharma-crm/api/scripts/
//   2. cd bepharma-crm
//   3. node api/scripts/create-lista-negra-property.js
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
  name: 'bp_lista_negra',
  label: 'Lista negra',
  type: 'bool',
  fieldType: 'booleancheckbox',
  groupName: 'companyinformation',
  description: 'Empresa marcada para NO contactar en futuros eventos. No se elimina de la base de datos, solo se excluye visualmente de la prospección.',
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
