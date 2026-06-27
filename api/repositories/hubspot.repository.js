const axios = require('axios')
const {
  DEAL_PROPERTIES,
  DEAL_DETAIL_PROPERTIES,
  COMPANY_PROPERTIES,
  CONTACT_PROPERTIES,
} = require('../config/hubspotProperties')

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
})

// ── Deals ─────────────────────────────────────────────────────────────────────

async function searchDeals({ filterGroups = [], sorts = [], limit = 50, after, properties } = {}) {
  const r = await hs.post('/crm/v3/objects/deals/search', {
    filterGroups,
    sorts,
    limit,
    after,
    properties: properties || DEAL_PROPERTIES,
  })
  return r.data
}

async function getDealById(id, { properties, associations } = {}) {
  const r = await hs.get(`/crm/v3/objects/deals/${id}`, {
    params: {
      properties: (properties || DEAL_DETAIL_PROPERTIES).join(','),
      associations: associations || 'contacts,companies,notes,calls,tasks',
    },
  })
  return r.data
}

async function updateDeal(id, properties) {
  const r = await hs.patch(`/crm/v3/objects/deals/${id}`, { properties })
  return r.data
}

async function createDeal(properties) {
  const r = await hs.post('/crm/v3/objects/deals', { properties })
  return r.data
}

async function deleteDeal(id) {
  await hs.delete(`/crm/v3/objects/deals/${id}`)
}

// ── Companies ─────────────────────────────────────────────────────────────────

async function searchCompanies({ filterGroups = [], sorts = [], limit = 50, after, properties } = {}) {
  const r = await hs.post('/crm/v3/objects/companies/search', {
    filterGroups,
    sorts,
    limit,
    after,
    properties: properties || COMPANY_PROPERTIES,
  })
  return r.data
}

async function getCompanyById(id) {
  const r = await hs.get(`/crm/v3/objects/companies/${id}`, {
    params: {
      properties: COMPANY_PROPERTIES.join(','),
      associations: 'contacts,deals,notes',
    },
  })
  return r.data
}

async function updateCompany(id, properties) {
  const r = await hs.patch(`/crm/v3/objects/companies/${id}`, { properties })
  return r.data
}

async function deleteCompany(id) {
  await hs.delete(`/crm/v3/objects/companies/${id}`)
}

// ── Contacts ──────────────────────────────────────────────────────────────────

async function searchContacts({ filterGroups = [], sorts = [], limit = 50, after, properties } = {}) {
  const r = await hs.post('/crm/v3/objects/contacts/search', {
    filterGroups,
    sorts,
    limit,
    after,
    properties: properties || CONTACT_PROPERTIES,
  })
  return r.data
}

async function getContactById(id) {
  const r = await hs.get(`/crm/v3/objects/contacts/${id}`, {
    params: {
      properties: CONTACT_PROPERTIES.join(','),
      associations: 'companies,deals,notes,calls',
    },
  })
  return r.data
}

async function updateContact(id, properties) {
  const r = await hs.patch(`/crm/v3/objects/contacts/${id}`, { properties })
  return r.data
}

async function createContact(properties) {
  const r = await hs.post('/crm/v3/objects/contacts', { properties })
  return r.data
}

async function deleteContact(id) {
  await hs.delete(`/crm/v3/objects/contacts/${id}`)
}

// ── Associations ──────────────────────────────────────────────────────────────

async function getAssociations(fromType, fromId, toType) {
  const r = await hs.get(`/crm/v3/objects/${fromType}/${fromId}/associations/${toType}`)
  return r.data.results || []
}

async function createAssociation(fromType, fromId, toType, toId, assocType) {
  await hs.put(`/crm/v3/objects/${fromType}/${fromId}/associations/${toType}/${toId}/${assocType}`)
}

// ── Engagements: notas ────────────────────────────────────────────────────────

async function createNote({ body, ownerId, objectType, objectId }) {
  const assocTypeMap = {
    deals: 'note_to_deal',
    contacts: 'note_to_contact',
    companies: 'note_to_company',
  }
  const r = await hs.post('/crm/v3/objects/notes', {
    properties: {
      hs_note_body: body,
      hs_timestamp: new Date().toISOString(),
      hubspot_owner_id: ownerId,
    },
  })
  const noteId = r.data.id
  if (objectType && objectId) {
    await createAssociation('notes', noteId, objectType, objectId, assocTypeMap[objectType] || 'note_to_deal')
      .catch(e => console.warn('[hubspot] note association error:', e.message))
  }
  return r.data
}

// ── Engagements: llamadas ─────────────────────────────────────────────────────

async function createCall({ body, durationMs, status, direction = 'OUTBOUND', ownerId, objectType, objectId, phoneNumber, recordingUrl, title, timestamp }) {
  const assocTypeMap = {
    deals: 'call_to_deal',
    contacts: 'call_to_contact',
    companies: 'call_to_company',
  }
  const props = {
    hs_call_body: body || '',
    hs_call_duration: String(durationMs || 0),
    hs_call_status: status || 'COMPLETED',
    hs_call_direction: direction,
    hs_timestamp: timestamp || new Date().toISOString(),
    hubspot_owner_id: ownerId,
  }
  if (phoneNumber) props.hs_call_to_number = phoneNumber
  if (recordingUrl) props.hs_call_recording_url = recordingUrl
  if (title) props.hs_call_title = title

  const r = await hs.post('/crm/v3/objects/calls', { properties: props })
  const callId = r.data.id
  if (objectType && objectId) {
    await createAssociation('calls', callId, objectType, objectId, assocTypeMap[objectType] || 'call_to_deal')
      .catch(e => console.warn('[hubspot] call association error:', e.message))
  }
  return r.data
}

// ── Engagements: tareas ───────────────────────────────────────────────────────

async function createTask({ subject, body, dueDate, priority = 'MEDIUM', ownerId, objectType, objectId }) {
  const assocTypeMap = {
    deals: 'task_to_deal',
    contacts: 'task_to_contact',
    companies: 'task_to_company',
  }
  const r = await hs.post('/crm/v3/objects/tasks', {
    properties: {
      hs_task_subject: subject,
      hs_task_body: body || '',
      hs_timestamp: new Date(dueDate).toISOString(),
      hs_task_priority: priority,
      hs_task_status: 'NOT_STARTED',
      hubspot_owner_id: ownerId,
    },
  })
  const taskId = r.data.id
  if (objectType && objectId) {
    await createAssociation('tasks', taskId, objectType, objectId, assocTypeMap[objectType] || 'task_to_deal')
      .catch(e => console.warn('[hubspot] task association error:', e.message))
  }
  return r.data
}

async function searchTasksForDeal(dealId) {
  const r = await hs.get(`/crm/v4/objects/deals/${dealId}/associations/tasks?limit=100`)
  return r.data.results || []
}

// ── Owners ────────────────────────────────────────────────────────────────────

async function getOwners() {
  const r = await hs.get('/crm/v3/owners')
  return r.data
}

// ── Count helper (usado en metricas) ─────────────────────────────────────────

async function countDeals(filterGroups) {
  try {
    const r = await hs.post('/crm/v3/objects/deals/search', {
      filterGroups,
      limit: 1,
      properties: ['dealname'],
    })
    return r.data.total || 0
  } catch (e) {
    console.error('[hubspot] countDeals error:', e.response?.data || e.message)
    return 0
  }
}

module.exports = {
  hs,
  searchDeals,
  getDealById,
  updateDeal,
  createDeal,
  deleteDeal,
  searchCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  searchContacts,
  getContactById,
  updateContact,
  createContact,
  deleteContact,
  getAssociations,
  createAssociation,
  createNote,
  createCall,
  createTask,
  searchTasksForDeal,
  getOwners,
  countDeals,
}
