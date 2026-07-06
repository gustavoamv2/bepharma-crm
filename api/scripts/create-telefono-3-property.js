// Script de un solo uso: crea la propiedad personalizada "bp_telefono_3"
// (teléfono) tanto en el objeto Empresa como en el objeto Contacto de HubSpot.
//
// Contexto: contactos y empresas ahora soportan hasta 3 números de teléfono:
//   - Teléfono 1 → propiedad estándar "phone" (ya existe en ambos objetos)
//   - Teléfono 2 → Empresa: "bp_telefonos_adicionales" (ya existía, sin usar)
//                  Contacto: "mobilephone" (propiedad estándar de HubSpot)
//   - Teléfono 3 → "bp_telefono_3" (creada por este script, en ambos objetos)
//
// Cómo correrlo (una sola vez, desde tu máquina — el sandbox de Claude no
// tiene salida a internet hacia api.hubapi.com):
//   1. cd bepharma-crm
//   2. node api/scripts/create-telefono-3-property.js
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

const TARGETS = [
  {
    object: 'companies',
    label: 'Empresa',
    property: {
      name: 'bp_telefono_3',
      label: 'Teléfono 3',
      type: 'string',
      fieldType: 'phonenumber',
      groupName: 'companyinformation',
      description: 'Tercer número de teléfono de la empresa (Teléfono 1 = "phone", Teléfono 2 = "bp_telefonos_adicionales").',
    },
  },
  {
    object: 'contacts',
    label: 'Contacto',
    property: {
      name: 'bp_telefono_3',
      label: 'Teléfono 3',
      type: 'string',
      fieldType: 'phonenumber',
      groupName: 'contactinformation',
      description: 'Tercer número de teléfono del contacto (Teléfono 1 = "phone", Teléfono 2 = "mobilephone").',
    },
  },
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
