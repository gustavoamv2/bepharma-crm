/**
 * emailTemplatesStore — guarda las plantillas de email de cada usuario
 * (lista de { id, name, subject, bodyHtml }).
 *
 * Mismo patrón que signatureStore.js: usa Redis (Upstash) vía su API REST
 * cuando las env vars existen (persiste entre despliegues/instancias); si no,
 * cae a /tmp (no persiste entre invocaciones frías en Vercel, pero sirve para
 * desarrollo local sin configurar KV).
 */
const fs = require('fs')
const axios = require('axios')

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
const LOCAL_FALLBACK = '/tmp/bp_email_templates.json'

function kvEnabled() {
  return !!(KV_URL && KV_TOKEN)
}

function keyFor(username) {
  return `bp_email_templates:${username.toLowerCase()}`
}

function readLocal() {
  try { return JSON.parse(fs.readFileSync(LOCAL_FALLBACK, 'utf8')) } catch { return {} }
}

function writeLocal(all) {
  try { fs.writeFileSync(LOCAL_FALLBACK, JSON.stringify(all, null, 2)) } catch { /* no bloquea la respuesta */ }
}

async function getTemplates(username) {
  if (kvEnabled()) {
    const r = await axios.get(`${KV_URL}/get/${encodeURIComponent(keyFor(username))}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    })
    const raw = r.data?.result
    return raw ? JSON.parse(raw) : []
  }
  const all = readLocal()
  return all[username.toLowerCase()] || []
}

async function saveTemplates(username, templates) {
  if (kvEnabled()) {
    await axios.post(`${KV_URL}/set/${encodeURIComponent(keyFor(username))}`, JSON.stringify(templates), {
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
    })
    return
  }
  const all = readLocal()
  all[username.toLowerCase()] = templates
  writeLocal(all)
}

module.exports = { getTemplates, saveTemplates, kvEnabled }
