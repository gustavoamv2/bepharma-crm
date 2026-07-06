// Script de diagnóstico (no modifica nada): imprime, DIRECTO desde la API de
// HubSpot (sin pasar por el CRM ni por ningún caché), los 3 teléfonos y 3
// emails de una empresa — para confirmar si un cambio realmente se guardó
// en HubSpot o si el problema es solo de caché/visualización en el CRM.
//
// Uso (desde tu máquina, dentro de bepharma-crm):
//   node api/scripts/check-company-phones-emails.js hetero.com
//   node api/scripts/check-company-phones-emails.js 123456789   (por ID de HubSpot)
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN).

require('dotenv').config()
const axios = require('axios')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('❌ No se encontró HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const query = process.argv[2]
if (!query) {
  console.error('❌ Uso: node api/scripts/check-company-phones-emails.js <dominio-o-id>')
  process.exit(1)
}

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const PROPERTIES = [
  'name', 'domain',
  'phone', 'bp_telefonos_adicionales', 'bp_telefono_3',
  'bp_email_empresa', 'bp_email_2', 'bp_email_3',
  'hs_lastmodifieddate',
]

async function findByDomain(domain) {
  const r = await hs.post('/crm/v3/objects/companies/search', {
    filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
    properties: PROPERTIES,
    limit: 5,
  })
  return r.data.results || []
}

async function getById(id) {
  try {
    const r = await hs.get(`/crm/v3/objects/companies/${id}`, { params: { properties: PROPERTIES.join(',') } })
    return [r.data]
  } catch (e) {
    if (e.response?.status === 404) return []
    throw e
  }
}

async function main() {
  const isId = /^\d+$/.test(query)
  const results = isId ? await getById(query) : await findByDomain(query)

  if (results.length === 0) {
    console.log(`⚠️  No se encontró ninguna empresa para "${query}".`)
    return
  }

  results.forEach(c => {
    const p = c.properties || {}
    console.log('─'.repeat(60))
    console.log(`Empresa: ${p.name}  (id: ${c.id})`)
    console.log(`Dominio: ${p.domain}`)
    console.log(`Última modificación (HubSpot): ${p.hs_lastmodifieddate}`)
    console.log('')
    console.log(`Teléfono 1 (phone):                 ${p.phone || '—'}`)
    console.log(`Teléfono 2 (bp_telefonos_adicionales): ${p.bp_telefonos_adicionales || '—'}`)
    console.log(`Teléfono 3 (bp_telefono_3):          ${p.bp_telefono_3 || '—'}`)
    console.log('')
    console.log(`Email 1 (bp_email_empresa):         ${p.bp_email_empresa || '—'}`)
    console.log(`Email 2 (bp_email_2):                ${p.bp_email_2 || '—'}`)
    console.log(`Email 3 (bp_email_3):                ${p.bp_email_3 || '—'}`)
  })
  console.log('─'.repeat(60))
}

main().catch(e => {
  console.error('❌ Error consultando HubSpot:', e.response?.data || e.message)
  process.exit(1)
})
