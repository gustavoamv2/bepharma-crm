/**
 * usersStore - almacenamiento de usuarios/config runtime.
 *
 * El bundle de Vercel es read-only y /tmp es efimero. Para que los cambios
 * hechos desde Admin sobrevivan a reinicios/deploys, usamos Redis/Upstash
 * cuando estan configuradas las env vars. El JSON del repo queda como base y
 * fallback local.
 */
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const USERS_SRC = path.join(__dirname, 'users.json')
const USERS_TMP = '/tmp/bp_users.json'
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
const USERS_KEY = 'bp_users_config_v1'
const KV_TIMEOUT_MS = Number(process.env.USERS_KV_TIMEOUT_MS || 1500)

let _cache = null

function kvEnabled() {
  return !!(KV_URL && KV_TOKEN)
}

function readBundleUsers() {
  return JSON.parse(fs.readFileSync(USERS_SRC, 'utf8'))
}

function readTmpUsers() {
  try {
    if (fs.existsSync(USERS_TMP)) return JSON.parse(fs.readFileSync(USERS_TMP, 'utf8'))
  } catch {}
  return null
}

function writeLocal(users) {
  try { fs.writeFileSync(USERS_TMP, JSON.stringify(users, null, 2)) } catch {}
  try { fs.writeFileSync(USERS_SRC, JSON.stringify(users, null, 2)) } catch {}
}

function loadUsers() {
  if (_cache) return _cache
  _cache = readTmpUsers() || readBundleUsers()
  return _cache
}

async function loadUsersPersistent() {
  if (kvEnabled()) {
    try {
      const r = await axios.get(KV_URL + '/get/' + encodeURIComponent(USERS_KEY), {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        timeout: KV_TIMEOUT_MS,
      })
      const raw = r.data?.result
      if (raw) {
        _cache = JSON.parse(raw)
        writeLocal(_cache)
        return _cache
      }
    } catch (e) {
      console.warn('[usersStore] Redis/Upstash read failed, using local fallback:', e.response?.data || e.message)
    }
  }
  return loadUsers()
}

function saveUsers(users) {
  _cache = users
  writeLocal(users)
}

async function saveUsersPersistent(users) {
  _cache = users
  writeLocal(users)
  if (kvEnabled()) {
    await axios.post(KV_URL + '/set/' + encodeURIComponent(USERS_KEY), JSON.stringify(users), {
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
      timeout: Math.max(KV_TIMEOUT_MS, 5000),
    })
  }
}

module.exports = { loadUsers, saveUsers, loadUsersPersistent, saveUsersPersistent, kvEnabled }
