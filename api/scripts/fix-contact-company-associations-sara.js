// Script de un solo uso: asocia los Contactos importados (Sara) con su
// Empresa correspondiente.
//
// A diferencia del batch de Angel (donde la asociacion Contacto-Empresa SI
// quedo bien via el import nativo, y solo fallo Deal-Empresa), en el batch
// de Carlos el import nativo NO asocio NADA: se confirmo con la API que las
// 971 empresas de Sara (bp_zona = 'carlos') tienen 0 contactos asociados.
//
// Este script NO toca propiedades de los contactos, solo crea la asociacion
// Contact <-> Company via la API v4 (idempotente: si ya existe la
// asociacion, no la duplica).
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/fix-contact-company-associations-sara.js --dry-run
//   node api/scripts/fix-contact-company-associations-sara.js --confirm
//
// Lee el token desde bepharma-crm/.env (HUBSPOT_ACCESS_TOKEN) y el mapeo
// contacto->dominio desde api/scripts/data/contactos_empresa_map_sara.json
// (ya incluido, exportado de la hoja CONTACTOS del Excel de Carlos).
// Matchea por EMAIL exacto (identificador que HubSpot uso para crear cada
// contacto en el import nativo) + dominio de empresa. Los contactos sin
// email (438 en el batch de Carlos, ver hoja REVISAR) no se pueden matchear
// de forma segura y se listan aparte -- no se adivina por nombre.
//
// FIX CRITICO #1 (03-jul-2026, detectado en el --dry-run inicial): las 971
// empresas de Sara quedaron con la propiedad ESTANDAR "domain" vacia
// (0/971) -- la primera version de este script matcheaba por "domain"
// contra TODAS las empresas del portal, y los "1980 listos para asociar"
// del primer dry-run eran en realidad empresas de OTRO operador que
// coincidian por dominio. Fix: ahora se matchea por bp_dominio_normalizado
// Y se filtra SOLO a empresas con bp_zona='sara'. Si dos empresas de
// Carlos comparten el mismo bp_dominio_normalizado, se marca ambiguo y no
// se asocia.
//
// FIX CRITICO #2 (04-jul-2026, detectado DESPUES de correr --confirm): la
// primera version de resolveAssociationTypeId() elegia el primer resultado
// con category='HUBSPOT_DEFINED' que devolviera el endpoint de labels. Esta
// cuenta tiene MAS DE UNO con esa categoria -- un dry-run devolvio typeId
// 279 y la corrida real (minutos despues) devolvio typeId 931, porque el
// orden del array no es estable entre llamadas. Resultado: los 1989
// contactos de Carlos quedaron asociados con un tipo que HubSpot NO usa
// para poblar "Empresa asociada" / num_associated_contacts (se verifico:
// ese contador siguio en 277 despues de la corrida "real"). Esas 1989
// asociaciones ya creadas no se borran solas (quedan como asociacion
// extra, no deberian romper nada) -- este fix hace que la proxima corrida
// use SIEMPRE el typeId HUBSPOT_DEFINED mas bajo (deterministico, no el
// primero que devuelva el array) y ademas imprime la lista completa de
// tipos disponibles para poder verificarlo a ojo antes de confirmar.

require('dotenv').config()
const axios = require('axios')
const readline = require('readline')
const path = require('path')
const fs = require('fs')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('No se encontro HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DATA_FILE = process.argv.find(a => a.startsWith('--data='))
  ? process.argv.find(a => a.startsWith('--data=')).split('=')[1]
  : path.join(__dirname, 'data', 'contactos_empresa_map_sara.json')

const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200
const OPERATOR_ZONE = 'sara'

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function resolveAssociationTypeId() {
  const { data } = await hs.get('/crm/v4/associations/contacts/companies/labels')
  const results = data.results || []
  console.log('  Tipos de asociacion Contact->Company disponibles en esta cuenta:')
  results.forEach(r => console.log(`    - category=${r.category} typeId=${r.typeId} label=${r.label || '(sin etiqueta)'}`))
  const defined = results.filter(r => r.category === 'HUBSPOT_DEFINED')
  const pool = defined.length > 0 ? defined : results
  const defaultType = pool.reduce((min, r) => (min === null || r.typeId < min.typeId ? r : min), null)
  if (!defaultType) throw new Error('No se encontro ningun tipo de asociacion Contact->Company en esta cuenta')
  return { category: defaultType.category, typeId: defaultType.typeId }
}

async function fetchCompanyDomainToId() {
  // domain -> companyId, SOLO para empresas de bp_zona='sara' (evita
  // cruzar por error con empresas de otro operador que compartan dominio).
  // Usa bp_dominio_normalizado como fuente primaria. Si un mismo dominio
  // aparece en mas de una empresa de Carlos, se marca ambiguo (id = null).
  const map = new Map()
  const seenCount = new Map()
  let leidas = 0
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/companies', {
      params: { limit: 100, properties: 'domain,bp_dominio_normalizado,bp_zona', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      leidas++
      if ((r.properties.bp_zona || '').trim().toLowerCase() !== OPERATOR_ZONE) continue
      const domain = (r.properties.domain || r.properties.bp_dominio_normalizado || '').trim().toLowerCase()
      if (!domain) continue
      seenCount.set(domain, (seenCount.get(domain) || 0) + 1)
      map.set(domain, r.id)
    }
    process.stdout.write(`\r  Empresas leidas (total portal): ${leidas}, con zona=sara y dominio: ${map.size}…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  for (const [domain, count] of seenCount) {
    if (count > 1) map.set(domain, null)
  }
  return map
}

async function fetchContactEmailToId() {
  const map = new Map()
  let after
  while (true) {
    const { data } = await hs.get('/crm/v3/objects/contacts', {
      params: { limit: 100, properties: 'email', ...(after ? { after } : {}) },
    })
    const results = data.results || []
    for (const r of results) {
      if (r.properties.email) map.set(r.properties.email.trim().toLowerCase(), r.id)
    }
    process.stdout.write(`\r  Contactos leidos: ${map.size}…`)
    after = data.paging?.next?.after
    if (!after || results.length === 0) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return map
}

async function createAssociationBatch(pairs, assocType) {
  const inputs = pairs.map(p => ({
    from: { id: p.contactId },
    to: { id: p.companyId },
    types: [{ associationCategory: assocType.category, associationTypeId: assocType.typeId }],
  }))
  await hs.post('/crm/v4/associations/contacts/companies/batch/create', { inputs })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto va a asociar Contactos con Empresas existentes en HubSpot.\nEscribe exactamente "ASOCIAR CONTACTOS" para continuar: ', resolve)
  })
  rl.close()
  return answer.trim() === 'ASOCIAR CONTACTOS'
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ No se encontró el archivo de datos: ${DATA_FILE}`)
    process.exit(1)
  }
  const rows = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  console.log(`Contactos en el archivo fuente: ${rows.length}`)
  console.log(DRY_RUN ? 'Modo: --dry-run (solo matching, no asocia nada)\n' : 'Modo: ASOCIACION REAL\n')

  console.log('Consultando tipo de asociacion Contact->Company…')
  const assocType = await resolveAssociationTypeId()
  console.log(`  Usando associationCategory=${assocType.category} typeId=${assocType.typeId}\n`)

  console.log('Descargando dominios de Empresas…')
  const companyByDomain = await fetchCompanyDomainToId()
  console.log(`Total empresas con dominio (zona sara): ${companyByDomain.size}\n`)

  console.log('Descargando emails de Contactos existentes…')
  const contactByEmail = await fetchContactEmailToId()
  console.log('')

  const toAssociate = []
  let sinEmail = 0
  let sinDominio = 0
  let dominioSinEmpresa = 0
  let dominioAmbiguo = 0
  let emailSinContacto = 0

  for (const row of rows) {
    const email = (row.email || '').trim().toLowerCase()
    const domain = (row.domain || '').trim().toLowerCase()
    if (!email) { sinEmail++; continue }
    if (!domain) { sinDominio++; continue }

    const companyId = companyByDomain.get(domain)
    if (companyId === undefined) { dominioSinEmpresa++; continue }
    if (companyId === null) { dominioAmbiguo++; continue }

    const contactId = contactByEmail.get(email)
    if (!contactId) { emailSinContacto++; continue }

    toAssociate.push({ contactId, companyId, email })
  }

  console.log(`Listos para asociar: ${toAssociate.length}`)
  console.log(`Sin email en el Excel fuente (no se puede matchear): ${sinEmail}`)
  console.log(`Sin dominio de empresa en el Excel fuente: ${sinDominio}`)
  console.log(`Dominio sin empresa correspondiente (zona sara) en HubSpot: ${dominioSinEmpresa}`)
  console.log(`Dominio ambiguo (2+ empresas de Sara con el mismo dominio): ${dominioAmbiguo}`)
  console.log(`Email no encontrado entre los contactos existentes en HubSpot: ${emailSinContacto}`)

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run activo: no se asoció nada. Corre con --confirm para asociar de verdad.')
    return
  }

  if (toAssociate.length === 0) {
    console.log('\n✅ Nada que asociar.')
    return
  }

  const ok = await confirmPhrase()
  if (!ok) {
    console.log('❌ Cancelado — no se asoció nada.')
    return
  }

  console.log('\nAsociando en lotes de 100…')
  let done = 0
  for (let i = 0; i < toAssociate.length; i += BATCH_SIZE) {
    const chunk = toAssociate.slice(i, i + BATCH_SIZE)
    try {
      await createAssociationBatch(chunk, assocType)
    } catch (e) {
      console.error(`\n❌ Error en lote ${i / BATCH_SIZE + 1}:`, e.response?.data || e.message)
      console.error('   Continuando con el siguiente lote…')
    }
    done += chunk.length
    process.stdout.write(`\r  ${done}/${toAssociate.length} asociaciones procesadas…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log(`\n\n✅ Listo. ${done} contactos asociados a su empresa.`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
