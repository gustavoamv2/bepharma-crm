import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(config => {
  const token = sessionStorage.getItem('bp_token')
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  // Toggle vista operador para supervisores
  const viewMode = sessionStorage.getItem('bp_view_mode')
  if (viewMode) config.headers['x-view-mode'] = viewMode
  return config
})

// ── HubSpot ───────────────────────────────────────────────────────────────────
export const hubspot = {
  metrics:     () => api.get('/hubspot/metrics').then(r => r.data),
  charts:      () => api.get('/hubspot/charts').then(r => r.data),

  searchDeals:  (body)       => api.post('/hubspot/deals/search', body).then(r => r.data),
  getDeal:      (id)         => api.get(`/hubspot/deals/${id}`).then(r => r.data),
  createDeal:   (props)      => api.post('/hubspot/deals', props).then(r => r.data),
  updateDeal:   (id, props)  => api.patch(`/hubspot/deals/${id}`, props).then(r => r.data),
  deleteDeal:   (id)         => api.delete(`/hubspot/deals/${id}`).then(r => r.data),

  searchCompanies: (body)      => api.post('/hubspot/companies/search', body).then(r => r.data),
  getCompany:      (id)        => api.get(`/hubspot/companies/${id}`).then(r => r.data),
  createCompany:   (props)     => api.post('/hubspot/companies', props).then(r => r.data),
  updateCompany:   (id, props) => api.patch(`/hubspot/companies/${id}`, props).then(r => r.data),
  deleteCompany:   (id)        => api.delete(`/hubspot/companies/${id}`).then(r => r.data),

  searchContacts: (body)      => api.post('/hubspot/contacts/search', body).then(r => r.data),
  getContact:     (id)        => api.get(`/hubspot/contacts/${id}`).then(r => r.data),
  createContact:  (props)     => api.post('/hubspot/contacts', props).then(r => r.data),
  updateContact:  (id, props) => api.patch(`/hubspot/contacts/${id}`, props).then(r => r.data),
  deleteContact:  (id)        => api.delete(`/hubspot/contacts/${id}`).then(r => r.data),

  getEngagements:  (type, id) => api.get(`/hubspot/engagements/${type}/${id}`).then(r => r.data),
  getPendingTasks: ()         => api.get('/hubspot/tasks/pending').then(r => r.data),
  getOwners:       ()         => api.get('/hubspot/owners').then(r => r.data),
  getNotifications: ()        => api.get('/hubspot/notifications').then(r => r.data),
  quickSearchCompanies: (q)   => api.get(`/hubspot/companies/quick-search?q=${encodeURIComponent(q)}`).then(r => r.data),
  getCompanyPipeline:   ()    => api.get('/hubspot/companies/pipeline-metrics').then(r => r.data),

  createNote:      (objectType, objectId, body, noteType = 'NOTE') =>
    api.post('/hubspot/notes', { objectType, objectId, body, noteType }).then(r => r.data),
  logCall:         (data)     => api.post('/hubspot/calls/log', data).then(r => r.data),
  createTask:      (data)     => api.post('/hubspot/tasks', data).then(r => r.data),
  bulkUpdateStage: (ids, stage) => api.patch('/hubspot/companies/bulk-stage', { ids, stage }).then(r => r.data),
}

// ── Pipeline Kanban ───────────────────────────────────────────────────────────
export const pipeline = {
  getDeals:    ()            => api.get('/pipeline/deals').then(r => r.data),
  updateStage: (id, stage)   => api.patch(`/pipeline/deals/${id}/stage`, { stage }).then(r => r.data),
}

// ── Zadarma ───────────────────────────────────────────────────────────────────
export const zadarma = {
  call:     (from, to) => api.post('/zadarma/call', { from, to }).then(r => r.data),
  getCalls: (params)   => api.get('/zadarma/calls', { params }).then(r => r.data),
  getSip:   ()         => api.get('/zadarma/sip').then(r => r.data),
}

// ── Apollo ────────────────────────────────────────────────────────────────────
export const apollo = {
  searchPeople: (body) => api.post('/apollo/people/search', body).then(r => r.data),
  enrich:       (body) => api.post('/apollo/enrich', body).then(r => r.data),
}

// ── RocketReach ───────────────────────────────────────────────────────────────
export const rocketreach = {
  search: (body) => api.post('/rocketreach/search', body).then(r => r.data),
  lookup: (body) => api.post('/rocketreach/lookup', body).then(r => r.data),
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export const admin = {
  getUsers:        ()                               => api.get('/admin/users').then(r => r.data),
  updateSip:       (username, sipExtension)         => api.patch(`/admin/users/${username}/sip`, { sipExtension }).then(r => r.data),
  updateEmail:     (username, emailUser, emailPass) => api.patch(`/admin/users/${username}/email`, { emailUser, emailPass }).then(r => r.data),
  getIntegrations: ()                               => api.get('/admin/integrations').then(r => r.data),
}

// ── Email ─────────────────────────────────────────────────────────────────────
export const emailApi = {
  verify:    ()                         => api.get('/email/verify').then(r => r.data),
  saveConfig:(emailUser, emailPass)     => api.patch('/email/config', { emailUser, emailPass }).then(r => r.data),
}

// ── Reports ───────────────────────────────────────────────────────────────────
export const reports = {
  getActivity:  (days = 30)         => api.get(`/reports/activity?days=${days}`).then(r => r.data),
  getCalls:     (ownerId, days = 30) => api.get(`/reports/calls?ownerId=${ownerId}&days=${days}`).then(r => r.data),
  getNotes:     (ownerId, days = 30) => api.get(`/reports/notes?ownerId=${ownerId}&days=${days}`).then(r => r.data),
  getBpSummary: ()                   => api.get('/reports/bp-summary').then(r => r.data),
}
