/**
 * signatureStore — guarda la firma de email de cada usuario.
 *
 * Usa Redis (Upstash) vía su API REST cuando las env vars existen (persiste
 * de verdad entre despliegues e instancias). Vercel ya no ofrece "KV" como
 * producto nativo — el reemplazo es conectar la integración de Upstash desde
 * Storage → Marketplace Database Providers → Upstash, que puede inyectar el
 * par de env vars con el nombre clásico (KV_REST_API_URL/TOKEN, heredado de
 * cuando Vercel KV era Upstash con otra marca) o con el nombre propio de
 * Upstash (UPSTASH_REDIS_REST_URL/TOKEN) según la versión de la integración
 * — se soportan ambos. Si ninguno existe, cae a /tmp — igual que
 * usersStore.js — que en Vercel NO persiste entre invocaciones frías,
 * pero permite que la función no falle y siga sirviendo en desarrollo local.
 */
const fs   = require('fs')
const axios = require('axios')

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
const LOCAL_FALLBACK = '/tmp/bp_signatures.json'

function kvEnabled() {
  return !!(KV_URL && KV_TOKEN)
}

function keyFor(username) {
  return `bp_signature:${username.toLowerCase()}`
}

function readLocal() {
  try { return JSON.parse(fs.readFileSync(LOCAL_FALLBACK, 'utf8')) } catch { return {} }
}

function writeLocal(all) {
  try { fs.writeFileSync(LOCAL_FALLBACK, JSON.stringify(all, null, 2)) } catch { /* ignora — no bloquea la respuesta */ }
}

async function getSignature(username) {
  if (kvEnabled()) {
    const r = await axios.get(`${KV_URL}/get/${encodeURIComponent(keyFor(username))}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    })
    const raw = r.data?.result
    return raw ? JSON.parse(raw) : null
  }
  const all = readLocal()
  return all[username.toLowerCase()] || null
}

async function saveSignature(username, data) {
  if (kvEnabled()) {
    await axios.post(`${KV_URL}/set/${encodeURIComponent(keyFor(username))}`, JSON.stringify(data), {
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
    })
    return
  }
  const all = readLocal()
  all[username.toLowerCase()] = data
  writeLocal(all)
}

module.exports = { getSignature, saveSignature, kvEnabled }
