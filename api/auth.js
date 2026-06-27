const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const users = require('./users.json')
const { JWT_SECRET, JWT_TTL } = require('./config/env')

const SECRET = JWT_SECRET
const TOKEN_TTL = JWT_TTL

// ── Login ────────────────────────────────────────────────────────────────────
async function login(username, password) {
  const user = users[username.toLowerCase()]
  if (!user) throw new Error('Usuario no encontrado')

  const ok = await bcrypt.compare(password, user.password)
  if (!ok) throw new Error('Contraseña incorrecta')

  const payload = {
    username: username.toLowerCase(),
    name: user.name,
    role: user.role,           // 'supervisor' | 'operator'
    ownerId: user.ownerId,     // HubSpot owner ID
    sipExtension: user.sipExtension || ''  // Zadarma SIP extension
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

// ── Helpers para filtrar por propietario ─────────────────────────────────────
// Si el usuario es operador (o está en vista-operador), agrega filtro de owner
// El header x-view-mode: operator permite que supervisores simulen vista de operador
function applyOwnerFilter(req, filterGroups) {
  const viewMode = req.headers['x-view-mode']
  const actAsOperator = req.user?.role === 'operator' || viewMode === 'operator'

  if (actAsOperator) {
    const ownerFilter = {
      propertyName: 'hubspot_owner_id',
      operator: 'EQ',
      value: req.user.ownerId
    }
    if (!filterGroups || filterGroups.length === 0) {
      return [{ filters: [ownerFilter] }]
    }
    return filterGroups.map(group => ({
      ...group,
      filters: [...(group.filters || []), ownerFilter]
    }))
  }
  return filterGroups
}

module.exports = { login, requireAuth, applyOwnerFilter }
