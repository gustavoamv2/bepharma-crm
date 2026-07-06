// Script de un solo uso: crea las propiedades personalizadas "bp_email_2" y
// "bp_email_3" tanto en el objeto Empresa como en el objeto Contacto de
// HubSpot.
//
// Contexto: contactos y empresas ahora soportan hasta 3 correos electrónicos:
//   - Empresa:  Email 1 = "bp_email_empresa" (ya existía, sin usar en el form)
//               Email 2 = "bp_email_2" (nueva, creada por este script)
//               Email 3 = "bp_email_3" (nueva, creada por este script)
//   - Contacto: Email 1 = "email" (propiedad estándar de HubSpot)
//               Email 2 = "bp_email_2" (nueva, creada por este script)
//               Email 3 = "bp_email_3" (nueva, creada por este script)
//
// Cómo correrlo (una sola vez, desde tu máquina — el sandbox de Claude no
// tiene salida a internet hacia api.hubapi.com):
//   1. cd bepharma-crm
//   2. node api/scripts/create-email-2-3-properties.js
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

function makeProperty(n, groupName) {
  return {
    name: `bp_email_${n}`,
    label: `Email ${n}`,
    type: 'string',
    fieldType: 'text',
    groupName,
    description: `Correo electrónico adicional #${n}.`,
  }
}

const TARGETS = [
  { object: 'companies', label: 'Empresa',  property: makeProperty(2, 'companyinformation') },
  { object: 'companies', label: 'Empresa',  property: makeProperty(3, 'companyinformation') },
  { object: 'contacts',  label: 'Contacto', property: makeProperty(2, 'contactinformation') },
  { object: 'contacts',  label: 'Contacto', property: makeProperty(3, 'contactinformation') },
]

async function ensureProperty({ object, label, property }) {
  try {
    await hs.get(`/crm/v3/properties/${object}/${property.name}`)
    console.log(`✅ La propiedad "${property.name}" ya existe en ${label}. Nada que hacer.`)
    return
  } catch (e) {
    if (e.response?.status !== 404) {
      console.error(`❌ Error verificando la propiedad en ${label}:`, e.response?.data || e.message)
      process.exitCode = 1
      return
    }
  }

  try {
    await hs.post(`/crm/v3/properties/${object}`, property)
    console.log(`✅ Propiedad "${property.name}" creada correctamente en ${label}.`)
  } catch (e) {
    console.error(`❌ Error creando la propiedad en ${label}:`, e.response?.data || e.message)
    process.exitCode = 1
  }
}

async function main() {
  for (const target of TARGETS) {
    await ensureProperty(target)
  }
}

main()
