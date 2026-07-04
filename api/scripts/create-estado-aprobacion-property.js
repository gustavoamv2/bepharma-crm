// Script de un solo uso: crea la propiedad personalizada "bp_estado_aprobacion"
// (enumeración: pendiente / aprobada / rechazada) en el objeto Empresa de HubSpot.
//
// Contexto: los operadores ahora pueden crear empresas directamente (antes
// solo los supervisores podían), pero quedan en estado "pendiente" hasta que
// un supervisor las apruebe. El CRM crea automáticamente una tarea para los
// supervisores cuando un operador crea una empresa nueva (ver POST
// /api/hubspot/companies en server.js).
//
// Cómo correrlo (una sola vez, desde tu máquina — el sandbox de Claude no
// tiene salida a internet hacia api.hubapi.com):
//   1. cd bepharma-crm
//   2. node api/scripts/create-estado-aprobacion-property.js
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
  name: 'bp_estado_aprobacion',
  label: 'Estado de aprobación',
  type: 'enumeration',
  fieldType: 'select',
  groupName: 'companyinformation',
  description: 'Empresas creadas por operadores quedan en "pendiente" hasta que un supervisor las aprueba. Las creadas por un supervisor quedan "aprobada" automáticamente.',
  options: [
    { label: 'Pendiente de aprobación', value: 'pendiente',  displayOrder: 0, hidden: false },
    { label: 'Aprobada',                value: 'aprobada',   displayOrder: 1, hidden: false },
    { label: 'Rechazada',               value: 'rechazada',  displayOrder: 2, hidden: false },
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
