const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { loadUsers } = require('./usersStore')
const { JWT_SECRET, JWT_TTL } = require('./config/env')
const { labelsToEnglish } = require('./config/countries')

const SECRET = JWT_SECRET
const TOKEN_TTL = JWT_TTL

// ── Login ────────────────────────────────────────────────────────────────────
async function login(username, password) {
  const users = loadUsers()
  const user = users[username.toLowerCase()]
  if (!user) throw new Error('Usuario no encontrado')

  const ok = await bcrypt.compare(password, user.password)
  if (!ok) throw new Error('Contraseña incorrecta')

  const payload = {
    username: username.toLowerCase(),
    name: user.name,
    role: user.role,           // 'supervisor' | 'operator'
    ownerId: user.ownerId,     // HubSpot owner ID
    sipExtension: user.sipExtension || '',  // Zadarma SIP extension
    bp_paises: Array.isArray(user.bp_paises) ? user.bp_paises : [],  // Países BePharma asignados al operador
    canToggleView: user.canToggleView !== false  // false = solo vista supervisor, sin toggle a vista operador
  }

  const token = jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL })
  return { token, user: payload }
}

// ── Middleware ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization']
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autenticado' })
  }
  try {
    const decoded = jwt.verify(header.slice(7), SECRET)
    req.user = decoded   // { username, name, role, ownerId }
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Sesión expirada, vuelve a iniciar sesión' })
  }
}

// ── Helpers para filtrar por propietario / país ──────────────────────────────
// Si el usuario es operador (o está en vista-operador), agrega filtro de owner
// El header x-view-mode: operator permite que supervisores simulen vista de operador
function isActingAsOperator(req) {
  const viewMode = req.headers['x-view-mode']
  if (req.user?.role === 'operator') return true
  if (viewMode === 'operator' && req.user?.canToggleView === false) return false
  return viewMode === 'operator'
}

function addFilterToGroups(filterGroups, filter) {
  if (!filterGroups || filterGroups.length === 0) {
    return [{ filters: [filter] }]
  }
  return filterGroups.map(group => ({
    ...group,
    filters: [...(group.filters || []), filter]
  }))
}

function applyOwnerFilter(req, filterGroups) {
  if (!isActingAsOperator(req)) return filterGroups
  return addFilterToGroups(filterGroups, {
    propertyName: 'hubspot_owner_id',
    operator: 'EQ',
    value: req.user.ownerId
  })
}

// Restringe resultados a los países asignados al operador (req.user.bp_paises).
// propertyName: propiedad de HubSpot donde vive el país en ese objeto
//   (ej. 'bp_evento_paises' en deals, 'country' en empresas/contactos).
// translate: si true, convierte los países (guardados en español) a su
//   equivalente en inglés antes de filtrar (así están guardados 'country').
// Si el operador no tiene países asignados, no se agrega ningún filtro
// (comportamiento igual al actual, sin restricción) para no dejar a nadie
// sin ver nada por una configuración incompleta.
function applyCountryFilter(req, filterGroups, propertyName, { translate = false } = {}) {
  if (!isActingAsOperator(req)) return filterGroups
  const paises = req.user?.bp_paises
  if (!Array.isArray(paises) || paises.length === 0) return filterGroups
  const values = translate ? labelsToEnglish(paises) : paises
  return addFilterToGroups(filterGroups, {
    propertyName,
    operator: 'IN',
    values
  })
}

module.exports = { login, requireAuth, applyOwnerFilter, applyCountryFilter, addFilterToGroups }
