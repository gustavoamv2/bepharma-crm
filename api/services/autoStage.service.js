// Asignación automática de etapa (bp_estado_prospeccion) según cantidad de
// datos de contacto disponibles — regla de negocio definida por Gustavo (02-jul-2026):
//
//   Nueva              = 0 datos de contacto (ni teléfono ni email, de la
//                         empresa ni de sus contactos)
//   En Depuración      = 1 dato de contacto
//   En Enriquecimiento = 2 datos de contacto
//   Por Contactar      = 3+ datos de contacto, o 2+ contactos que tengan
//                         AMBOS (teléfono y correo) cada uno
//
// Las etapas En Seguimiento, Confirmada y No Participa son decisión del
// operador — este módulo NUNCA las sobreescribe.
//
// "Dato de contacto" = un teléfono o un email, sea de la empresa o de
// cualquier contacto asociado a ella (cada campo cuenta por separado).

const { hs } = require('../repositories/hubspot.repository')
const { AUTO_STAGE_KEYS } = require('../config/hubspotProperties')

function computeAutoStage({ companyPhone, companyEmail, contacts = [] }) {
  let dataPoints = 0
  let fullyQualifiedContacts = 0

  if (companyPhone) dataPoints++
  if (companyEmail) dataPoints++

  for (const c of contacts) {
    const hasPhone = !!c.phone
    const hasEmail = !!c.email
    if (hasPhone) dataPoints++
    if (hasEmail) dataPoints++
    if (hasPhone && hasEmail) fullyQualifiedContacts++
  }

  if (dataPoints >= 3 || fullyQualifiedContacts >= 2) return 'contacto_enviado' // Por Contactar
  if (dataPoints >= 2) return 'en_enriquecimiento'
  if (dataPoints >= 1) return 'en_depuracion'
  return 'nueva'
}

// Recalcula la etapa automática de una empresa y la aplica a todos sus deals
// que estén actualmente en una etapa automática (o sin etapa) — nunca toca
// deals ya movidos manualmente a En Seguimiento/Confirmada/No Participa.
async function recomputeDealStagesForCompany(companyId, opts = {}) {
  if (!companyId) return { skipped: true }
  const { dryRun = false } = opts

  try {
    // NOTA (03-jul-2026): este portal NO tiene una propiedad estandar "email" en
    // Empresas -- el campo real es "bp_email_empresa" ("Email corporativo empresa").
    // Antes se pedia "email" (que no existe), asi que companyEmail siempre daba ''
    // sin importar los datos reales de la empresa. Hoy bp_email_empresa tampoco
    // tiene datos cargados en ninguna empresa del portal, asi que el efecto
    // practico actual es el mismo (0), pero esto queda listo para cuando se
    // empiece a poblar ese campo.
    const companyR = await hs.get(`/crm/v3/objects/companies/${companyId}`, {
      params: { properties: 'phone,bp_email_empresa' },
    })
    const companyPhone = companyR.data.properties?.phone || ''
    const companyEmail = companyR.data.properties?.bp_email_empresa || ''

    const contactAssocR = await hs
      .get(`/crm/v3/objects/companies/${companyId}/associations/contacts`)
      .catch(() => ({ data: { results: [] } }))
    const contactIds = [...new Set((contactAssocR.data.results || []).map(r => r.id))]

    let contacts = []
    if (contactIds.length) {
      const cr = await hs.post('/crm/v3/objects/contacts/batch/read', {
        inputs: contactIds.map(id => ({ id })),
        properties: ['phone', 'email'],
      })
      contacts = (cr.data.results || []).map(c => ({
        phone: c.properties?.phone || '',
        email: c.properties?.email || '',
      }))
    }

    const newStage = computeAutoStage({ companyPhone, companyEmail, contacts })

    const dealAssocR = await hs
      .get(`/crm/v3/objects/companies/${companyId}/associations/deals`)
      .catch(() => ({ data: { results: [] } }))
    const dealIds = [...new Set((dealAssocR.data.results || []).map(r => r.id))]
    if (!dealIds.length) return { companyId, newStage, updatedDeals: [] }

    const dr = await hs.post('/crm/v3/objects/deals/batch/read', {
      inputs: dealIds.map(id => ({ id })),
      properties: ['bp_estado_prospeccion'],
    })

    const updatable = (dr.data.results || [])
      .filter(d => {
        const current = d.properties?.bp_estado_prospeccion
        const isAutoOrEmpty = !current || AUTO_STAGE_KEYS.includes(current)
        return isAutoOrEmpty && current !== newStage
      })
      .map(d => d.id)

    if (updatable.length && !dryRun) {
      await hs.post('/crm/v3/objects/deals/batch/update', {
        inputs: updatable.map(id => ({ id, properties: { bp_estado_prospeccion: newStage } })),
      })
    }

    return { companyId, newStage, updatedDeals: updatable, dryRun }
  } catch (err) {
    console.warn(
      '[autoStage] fallo al recalcular etapa para empresa', companyId, ':',
      err.response?.data?.message || err.message
    )
    return { error: true, companyId }
  }
}

// Dado un contactId, resuelve la(s) empresa(s) asociada(s) — útil antes/después
// de crear, editar o borrar un contacto para saber a quién recalcular.
async function getCompanyIdsForContact(contactId) {
  try {
    const r = await hs.get(`/crm/v3/objects/contacts/${contactId}/associations/companies`)
    return [...new Set((r.data.results || []).map(x => x.id))]
  } catch {
    return []
  }
}

module.exports = {
  computeAutoStage,
  recomputeDealStagesForCompany,
  getCompanyIdsForContact,
}
