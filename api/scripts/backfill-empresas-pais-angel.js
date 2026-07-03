// Script de backfill: llena "country" y "bp_zona" en las empresas de Angel
// que quedaron sin ninguno de los dos (las ~766 detectadas al intentar
// llenar bp_evento_paises en los deals -- ver backfill-deal-paises.js).
//
// Fuente de verdad: BePharma_Excel_Importacion_Angel_Empresas.xlsx que
// Gustavo subió (el mismo archivo usado para el import original de Angel,
// generado por transform_operator_excel_angel.py). Ya viene convertido a
// api/scripts/data/empresas_pais_angel.json (1,112 filas: bp_id_unico, name,
// domain [= bp_dominio_normalizado del Excel], country).
//
// Match por DOMINIO (domain de la empresa en HubSpot == domain del Excel) --
// mismo criterio que ya usan fix-deal-company-associations*.js, para no
// cruzar por error con una empresa de nombre parecido. Si el dominio no
// alcanza (empresa sin domain en HubSpot, o fila del Excel sin dominio),
// se intenta un segundo pase por NOMBRE EXACTO (normalizado) solo cuando es
// inequívoco (un único match en ambos lados).
//
// Este script SOLO toca empresas que hoy tienen "country" Y "bp_zona" vacíos
// -- nunca sobreescribe una empresa que ya tiene datos.
//
// Después de correr esto con --confirm, hay que volver a correr
// backfill-deal-paises.js --confirm para que el país recién cargado en la
// empresa se refleje también en bp_evento_paises del deal.
//
// Como correrlo (desde tu maquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/backfill-empresas-pais-angel.js --dry-run
//   node api/scripts/backfill-empresas-pais-angel.js --confirm

require('dotenv').config()
const axios = require('axios')
const readline = require('readline')
const path = require('path')
const fs = require('fs')

const { COUNTRIES } = require('../config/countries')

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
if (!TOKEN) {
  console.error('No se encontro HUBSPOT_ACCESS_TOKEN en .env')
  process.exit(1)
}

const DATA_FILE = path.join(__dirname, 'data', 'empresas_pais_angel.json')
const DRY_RUN = !process.argv.includes('--confirm')
const BATCH_SIZE = 100
const REQUEST_DELAY_MS = 200
const OPERATOR_ZONE = 'angel'
const REPORT_FILE = path.join(__dirname, 'data', 'empresas_pais_angel_report.json')

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── Normalización de país (mismo criterio que backfill-deal-paises.js) ──────
const ACCENT_MAP = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ñ: 'N', Ü: 'U',
}
const stripAccents = (s) => (s || '').split('').map(ch => ACCENT_MAP[ch] || ch).join('')
const normKey = (s) => stripAccents(s).trim().toLowerCase()
const byLabelNorm = new Map(COUNTRIES.map(c => [normKey(c.label), c.label]))
const byEnNorm = new Map(COUNTRIES.map(c => [normKey(c.en), c.label]))
function resolveCountryLabel(raw) {
  const key = normKey(raw)
  if (!key) return null
  return byLabelNorm.get(key) || byEnNorm.get(key) || null
}
const normDomain = (d) => (d || '').trim().toLowerCase().replace(/^www\./, '')
const normName = (n) => normKey(n).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

// ── Empresas del portal que hoy no tienen country NI bp_zona ─────────────────
async function fetchEmpresasSinDatos() {
  let all = []
  let after
  while (true) {
    const { data } = await hs.post('/crm/v3/objects/companies/search', {
      filterGroups: [{ filters: [
        { propertyName: 'country', operator: 'NOT_HAS_PROPERTY' },
        { propertyName: 'bp_zona', operator: 'NOT_HAS_PROPERTY' },
      ] }],
      limit: 100, after,
      properties: ['name', 'domain'],
    })
    all.push(...(data.results || []))
    process.stdout.write(`\r  Empresas sin país/zona leídas: ${all.length}…`)
    after = data.paging?.next?.after
    if (!after) break
    await sleep(REQUEST_DELAY_MS)
  }
  console.log('')
  return all
}

async function updateCompaniesBatch(pairs) {
  await hs.post('/crm/v3/objects/companies/batch/update', {
    inputs: pairs.map(p => ({ id: p.companyId, properties: { country: p.pais, bp_zona: OPERATOR_ZONE } })),
  })
}

async function confirmPhrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => {
    rl.question('\n⚠️  Esto va a escribir country + bp_zona en las empresas listadas arriba.\nEscribe exactamente "LLENAR EMPRESAS" para continuar: ', resolve)
  })
  rl.close()
  return answer.trim() === 'LLENAR EMPRESAS'
}

async function main() {
  console.log(DRY_RUN ? 'Modo: --dry-run (solo calcula, no escribe nada)\n' : 'Modo: ESCRITURA REAL\n')

  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ No se encontró ${DATA_FILE}`)
    process.exit(1)
  }
  const excelRows = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  console.log(`Filas del Excel de Angel: ${excelRows.length}`)

  const excelByDomain = new Map()
  const excelByName = new Map()
  for (const row of excelRows) {
    const label = resolveCountryLabel(row.country)
    if (!label) continue // pais del excel no reconocido en el catalogo -- se reporta al final si aplica
    if (row.domain) {
      const key = normDomain(row.domain)
      if (!excelByDomain.has(key)) excelByDomain.set(key, [])
      excelByDomain.get(key).push({ name: row.name, pais: label })
    }
    const nk = normName(row.name)
    if (nk) {
      if (!excelByName.has(nk)) excelByName.set(nk, [])
      excelByName.get(nk).push({ name: row.name, pais: label })
    }
  }

  console.log('\nBuscando empresas del portal sin país ni zona…')
  const empresas = await fetchEmpresasSinDatos()
  console.log(`Empresas sin país/zona en HubSpot: ${empresas.length}\n`)

  const toUpdate = []
  const sinMatch = []
  const ambiguas = []

  for (const c of empresas) {
    const domain = c.properties?.domain
    const name = c.properties?.name || ''
    let candidates = domain ? (excelByDomain.get(normDomain(domain)) || []) : []
    let matchedBy = 'domain'

    if (candidates.length === 0) {
      candidates = excelByName.get(normName(name)) || []
      matchedBy = 'name'
    }

    if (candidates.length === 0) {
      sinMatch.push({ companyId: c.id, name, domain: domain || '' })
    } else if (candidates.length > 1 && new Set(candidates.map(x => x.pais)).size > 1) {
      // Mismo dominio/nombre pero el Excel trae países distintos -- ambiguo
      ambiguas.push({ companyId: c.id, name, domain: domain || '', matchedBy, candidatos: candidates })
    } else {
      toUpdate.push({ companyId: c.id, name, pais: candidates[0].pais, matchedBy })
    }
  }

  console.log(`Listas para actualizar: ${toUpdate.length}`)
  console.log(`  · por dominio: ${toUpdate.filter(x => x.matchedBy === 'domain').length}`)
  console.log(`  · por nombre exacto (fallback): ${toUpdate.filter(x => x.matchedBy === 'name').length}`)
  console.log(`Sin match en el Excel de Angel: ${sinMatch.length}`)
  console.log(`Ambiguas (mismo dominio/nombre, países distintos en el Excel): ${ambiguas.length}`)

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true })
  fs.writeFileSync(REPORT_FILE, JSON.stringify({
    generadoEn: new Date().toISOString(),
    totalEmpresasSinDatos: empresas.length,
    resueltasEstaCorrida: toUpdate.length,
    sinMatch,
    ambiguas,
  }, null, 2))
  console.log(`\n📄 Reporte guardado en: ${REPORT_FILE}`)

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run activo: no se escribió nada. Corre con --confirm para aplicar los cambios.')
    return
  }

  if (toUpdate.length === 0) {
    console.log('\n✅ Nada seguro para actualizar en esta corrida.')
    return
  }

  const ok = await confirmPhrase()
  if (!ok) {
    console.log('❌ Cancelado — no se escribió nada.')
    return
  }

  console.log('\nActualizando en lotes de 100…')
  let done = 0
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE)
    try {
      await updateCompaniesBatch(chunk)
    } catch (e) {
      console.error(`\n❌ Error en lote ${i / BATCH_SIZE + 1}:`, e.response?.data || e.message)
      console.error('   Continuando con el siguiente lote…')
    }
    done += chunk.length
    process.stdout.write(`\r  ${done}/${toUpdate.length} empresas actualizadas…`)
    await sleep(REQUEST_DELAY_MS)
  }
  console.log(`\n\n✅ Listo. ${done} empresas actualizadas (country + bp_zona=angel).`)
  console.log(`   Ahora corre: node api/scripts/backfill-deal-paises.js --confirm`)
  console.log(`   para que el país recién cargado se refleje en bp_evento_paises de los deals.`)
}

main().catch(e => {
  console.error('\n❌ Error:', e.response?.data || e.message)
  process.exit(1)
})
