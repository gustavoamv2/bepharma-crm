const fs = require('fs')
const axios = require('axios')

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
const LOCAL_FALLBACK = '/tmp/bp_email_mailbox.json'
const STORE_KEY = 'bp_email_mailbox:v1'
const MAX_MESSAGES = Number(process.env.EMAIL_MAILBOX_MAX_MESSAGES || 2500)

function kvEnabled() { return !!(KV_URL && KV_TOKEN) }
function readLocal() { try { return JSON.parse(fs.readFileSync(LOCAL_FALLBACK, 'utf8')) } catch { return { messages: [] } } }
function writeLocal(data) { try { fs.writeFileSync(LOCAL_FALLBACK, JSON.stringify(data, null, 2)) } catch {} }

async function readStore() {
  if (kvEnabled()) {
    const r = await axios.get(`${KV_URL}/get/${encodeURIComponent(STORE_KEY)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } })
    return r.data?.result ? JSON.parse(r.data.result) : { messages: [] }
  }
  return readLocal()
}

async function writeStore(data) {
  const clean = {
    messages: (data.messages || []).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, MAX_MESSAGES),
    updatedAt: new Date().toISOString(),
  }
  if (kvEnabled()) {
    await axios.post(`${KV_URL}/set/${encodeURIComponent(STORE_KEY)}`, JSON.stringify(clean), {
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
    })
    return clean
  }
  writeLocal(clean)
  return clean
}

function normalizeEmail(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/<([^>]+)>/)
  return (match ? match[1] : raw).trim().toLowerCase()
}
function normalizeSubject(subject) {
  return String(subject || '(sin asunto)').replace(/^(re|fw|fwd):\s*/ig, '').trim().toLowerCase() || '(sin asunto)'
}
function computeThreadId(message) {
  if (message.threadId) return message.threadId
  if (message.dealId) return `deal:${message.dealId}:subject:${normalizeSubject(message.subject)}`
  if (message.contactId) return `contact:${message.contactId}:subject:${normalizeSubject(message.subject)}`
  const mailbox = normalizeEmail((message.to || [])[0] || message.from || 'unlinked')
  return `mailbox:${mailbox}:subject:${normalizeSubject(message.subject)}`
}
async function upsertMessage(message) {
  const store = await readStore()
  const now = new Date().toISOString()
  const id = message.id || message.resendEmailId || message.providerMessageId || `mail_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const normalized = { ...message, id, threadId: computeThreadId(message), folder: message.folder || (message.direction === 'outbound' ? 'sent' : 'inbox'), read: message.read ?? message.direction === 'outbound', readAt: message.readAt || (message.direction === 'outbound' ? now : ''), archived: !!message.archived || message.folder === 'archived', createdAt: message.createdAt || now, updatedAt: now }
  const idx = store.messages.findIndex(m => m.id === id || (normalized.resendEmailId && m.resendEmailId === normalized.resendEmailId))
  if (idx >= 0) store.messages[idx] = { ...store.messages[idx], ...normalized, updatedAt: now }
  else store.messages.push(normalized)
  await writeStore(store)
  return normalized
}
function canSeeMessage(user, msg) {
  if (!user) return false
  return String(msg.ownerId || '') === String(user.ownerId || '') || String(msg.ownerUsername || '').toLowerCase() === String(user.username || '').toLowerCase()
}
async function listMessages(user, opts = {}) {
  const store = await readStore()
  const folder = opts.folder || 'inbox'
  const q = String(opts.q || '').trim().toLowerCase()
  let messages = (store.messages || []).filter(m => canSeeMessage(user, m))
  if (folder === 'archived') messages = messages.filter(m => m.archived)
  else if (folder === 'unlinked') messages = messages.filter(m => !m.archived && !m.dealId && !m.contactId && !m.companyId)
  else if (folder !== 'all') messages = messages.filter(m => !m.archived && (m.folder || 'inbox') === folder)
  if (opts.dealId) messages = messages.filter(m => String(m.dealId || '') === String(opts.dealId))
  if (opts.threadId) messages = messages.filter(m => String(m.threadId || '') === String(opts.threadId))
  if (q) messages = messages.filter(m => [m.subject, m.from, ...(m.to || []), m.preview, m.companyName, m.dealName].filter(Boolean).join(' ').toLowerCase().includes(q))
  messages.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  const limit = Math.min(Number(opts.limit || 80), 200)
  return { total: messages.length, messages: messages.slice(0, limit), persisted: kvEnabled() }
}
async function getThread(user, threadId) {
  const store = await readStore()
  const messages = (store.messages || []).filter(m => String(m.threadId || '') === String(threadId) && canSeeMessage(user, m)).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
  return { threadId, messages, total: messages.length, persisted: kvEnabled() }
}
async function patchThread(user, threadId, patch = {}) {
  const store = await readStore()
  const now = new Date().toISOString()
  let changed = 0
  for (const msg of (store.messages || [])) {
    if (String(msg.threadId || '') === String(threadId) && canSeeMessage(user, msg)) {
      Object.assign(msg, patch, { updatedAt: now })
      if (patch.folder === 'archived') msg.archived = true
      if (patch.folder && patch.folder !== 'archived') msg.archived = false
      if (patch.readAt) msg.read = true
      msg.threadId = computeThreadId(msg)
      changed += 1
    }
  }
  if (!changed) return 0
  await writeStore(store)
  return changed
}
async function deleteMessage(user, id) {
  const store = await readStore()
  const idx = (store.messages || []).findIndex(m => String(m.id) === String(id))
  if (idx < 0) return null
  if (!canSeeMessage(user, store.messages[idx])) return false
  const [removed] = store.messages.splice(idx, 1)
  await writeStore(store)
  return removed
}
async function deleteThread(user, threadId) {
  const store = await readStore()
  const before = (store.messages || []).length
  store.messages = (store.messages || []).filter(m => !(String(m.threadId || '') === String(threadId) && canSeeMessage(user, m)))
  const deleted = before - store.messages.length
  if (!deleted) return 0
  await writeStore(store)
  return deleted
}

async function patchMessage(user, id, patch = {}) {
  const store = await readStore()
  const idx = (store.messages || []).findIndex(m => String(m.id) === String(id))
  if (idx < 0) return null
  if (!canSeeMessage(user, store.messages[idx])) return false
  store.messages[idx] = { ...store.messages[idx], ...patch, updatedAt: new Date().toISOString() }
  if (patch.folder === 'archived') store.messages[idx].archived = true
  if (patch.folder && patch.folder !== 'archived') store.messages[idx].archived = false
  if (patch.readAt) store.messages[idx].read = true
  store.messages[idx].threadId = computeThreadId(store.messages[idx])
  await writeStore(store)
  return store.messages[idx]
}
module.exports = { kvEnabled, upsertMessage, listMessages, getThread, patchMessage, patchThread, deleteMessage, deleteThread, normalizeEmail, normalizeSubject, computeThreadId }

