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

// â”€â”€ HubSpot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const hubspot = {
  metrics:     () => api.get('/hubspot/metrics').then(r => r.data),
  charts:      (params) => api.get('/hubspot/charts', { params }).then(r => r.data),

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
  getCompanyQualityMetrics: (params) => api.get('/hubspot/companies/quality-metrics', { params }).then(r => r.data),
  getContactQualityMetrics: (params) => api.get('/hubspot/contacts/quality-metrics', { params }).then(r => r.data),

  // Exportar a Excel â€” el backend pagina TODOS los resultados que cumplen
  // los filtros (no solo la pÃ¡gina visible) y arma el .xlsx con logo BePharma
  // + evento activo + resumen de filtros. Devuelve el blob para descargar.
  exportCompanies: (body) => api.post('/hubspot/companies/export', body, { responseType: 'blob' }).then(r => r.data),
  exportContacts:  (body) => api.post('/hubspot/contacts/export',  body, { responseType: 'blob' }).then(r => r.data),
  exportDeals:     (body) => api.post('/hubspot/deals/export',     body, { responseType: 'blob' }).then(r => r.data),

  createNote:      (objectType, objectId, body, noteType = 'NOTE') =>
    api.post('/hubspot/notes', { objectType, objectId, body, noteType }).then(r => r.data),
  logCall:         (data)     => api.post('/hubspot/calls/log', data).then(r => r.data),
  createTask:      (data)     => api.post('/hubspot/tasks', data).then(r => r.data),
  bulkUpdateStage: (ids, stage) => api.patch('/hubspot/companies/bulk-stage', { ids, stage }).then(r => r.data),
}

// Invalida las queries que alimentan el Dashboard (metrics/charts/deals-alertas).
// HubSpot tarda unos segundos en reflejar un property update en su Search API
// (Ã­ndice con consistencia eventual), por eso una sola invalidaciÃ³n inmediata
// puede traer datos todavÃ­a viejos si el usuario navega muy rÃ¡pido. Por eso
// invalidamos ya mismo y de nuevo un par de segundos despuÃ©s.
export function invalidateDashboard(qc) {
  const run = () => {
    qc.invalidateQueries('metrics')
    qc.invalidateQueries('charts')
    qc.invalidateQueries('deals-alertas')
  }
  run()
  setTimeout(run, 3000)
}

// â”€â”€ Pipeline Kanban â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const pipeline = {
  getDeals:    ()            => api.get('/pipeline/deals').then(r => r.data),
  updateStage: (id, stage)   => api.patch(`/pipeline/deals/${id}/stage`, { stage }).then(r => r.data),
}

// â”€â”€ Zadarma â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const zadarma = {
  call:     (from, to) => api.post('/zadarma/call', { from, to }).then(r => r.data),
  getCalls: (params)   => api.get('/zadarma/calls', { params }).then(r => r.data),
  getSip:   ()         => api.get('/zadarma/sip').then(r => r.data),
}

// â”€â”€ Apollo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const apollo = {
  searchPeople: (body) => api.post('/apollo/people/search', body).then(r => r.data),
  enrich:       (body) => api.post('/apollo/enrich', body).then(r => r.data),
}

// â”€â”€ RocketReach â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const rocketreach = {
  search: (body) => api.post('/rocketreach/search', body).then(r => r.data),
  lookup: (body) => api.post('/rocketreach/lookup', body).then(r => r.data),
}

// â”€â”€ Auth (recuperar / cambiar contraseÃ±a) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const authApi = {
  forgotPassword:  (username)                    => api.post('/auth/forgot-password', { username }).then(r => r.data),
  resetPassword:   (token, newPassword)          => api.post('/auth/reset-password', { token, newPassword }).then(r => r.data),
  changePassword:  (currentPassword, newPassword) => api.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data),
}

// â”€â”€ Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const admin = {
  getUsers:        ()                               => api.get('/admin/users').then(r => r.data),
  updateSip:       (username, sipExtension)         => api.patch(`/admin/users/${username}/sip`, { sipExtension }).then(r => r.data),
  updatePaises:    (username, bp_paises)            => api.patch(`/admin/users/${username}/paises`, { bp_paises }).then(r => r.data),
  updateEmail:     (username, emailUser, emailPass) => api.patch(`/admin/users/${username}/email`, { emailUser, emailPass }).then(r => r.data),
  getIntegrations: ()                               => api.get('/admin/integrations').then(r => r.data),
  recomputeAutoStages: ()                            => api.post('/admin/recompute-auto-stages').then(r => r.data),
  getEmailStatus:  ()                               => api.get('/admin/email-status').then(r => r.data),

  // Copia de seguridad completa (Empresas/Contactos/Deals + usuarios/firmas/
  // plantillas) â€” devuelve el blob para descargar. format: 'xlsx' | 'json'.
  // AdemÃ¡s de esta descarga manual, un cron semanal (ver vercel.json) envÃ­a
  // la misma copia por correo a cada supervisor automÃ¡ticamente.
  downloadBackup:  (format = 'xlsx')                => api.get('/admin/backup', { params: { format }, responseType: 'blob' }).then(r => r.data),
}

// â”€â”€ Email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Mailbox Resend / HubSpot
export const mailbox = {
  list:   (params) => api.get('/mailbox/messages', { params }).then(r => r.data),
  thread: (threadId) => api.get(`/mailbox/threads/${encodeURIComponent(threadId)}`).then(r => r.data),
  patch:  (id, patch) => api.patch(`/mailbox/messages/${id}`, patch).then(r => r.data),
  deleteMessage: (id) => api.delete(`/mailbox/messages/${id}`).then(r => r.data),
  deleteThread:  (threadId) => api.delete(`/mailbox/threads/${encodeURIComponent(threadId)}`).then(r => r.data),
  linkMessageToDeal: (id, dealId) => api.post(`/mailbox/messages/${id}/link-deal`, { dealId }).then(r => r.data),
  linkThreadToDeal:  (threadId, dealId) => api.post(`/mailbox/threads/${encodeURIComponent(threadId)}/link-deal`, { dealId }).then(r => r.data),
  sync:   () => api.post('/mailbox/sync-resend').then(r => r.data),
}
export const emailApi = {
  verify:    ()                         => api.get('/email/verify').then(r => r.data),
  saveConfig:(emailUser, emailPass)     => api.patch('/email/config', { emailUser, emailPass }).then(r => r.data),
}

// â”€â”€ Reports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const reports = {
  getActivity:  (days = 30)         => api.get(`/reports/activity?days=${days}`).then(r => r.data),
  getCalls:     (ownerId, days = 30) => api.get(`/reports/calls?ownerId=${ownerId}&days=${days}`).then(r => r.data),
  getNotes:     (ownerId, days = 30) => api.get(`/reports/notes?ownerId=${ownerId}&days=${days}`).then(r => r.data),
  getBpSummary: ()                   => api.get('/reports/bp-summary').then(r => r.data),
  exportActivity:  (body) => api.post('/reports/activity/export',    body, { responseType: 'blob' }).then(r => r.data),
  exportBpSummary: (body) => api.post('/reports/bp-summary/export',  body, { responseType: 'blob' }).then(r => r.data),
}

