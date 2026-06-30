/**
 * usersStore — almacén de usuarios compatible con Vercel (filesystem read-only).
 * Primero lee de /tmp/bp_users.json si existe (ediciones en runtime),
 * luego del bundle (users.json). Escribe en ambos.
 */
const fs   = require('fs')
const path = require('path')

const USERS_SRC = path.join(__dirname, 'users.json')
const USERS_TMP = '/tmp/bp_users.json'
let _cache = null

function loadUsers() {
  if (_cache) return _cache
  try {
    if (fs.existsSync(USERS_TMP)) {
      _cache = JSON.parse(fs.readFileSync(USERS_TMP, 'utf8'))
      return _cache
    }
  } catch {}
  _cache = JSON.parse(fs.readFileSync(USERS_SRC, 'utf8'))
  return _cache
}

function saveUsers(users) {
  _cache = users
  try { fs.writeFileSync(USERS_TMP, JSON.stringify(users, null, 2)) } catch {}
  try { fs.writeFileSync(USERS_SRC, JSON.stringify(users, null, 2)) } catch {}
}

module.exports = { loadUsers, saveUsers }
