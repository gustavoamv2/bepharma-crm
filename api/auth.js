const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { loadUsersPersistent, saveUsersPersistent } = require('./usersStore')
const { JWT_SECRET, JWT_TTL } = require('./config/env')
const { labelsToEnglish } = require('./config/countries')

const SECRET = JWT_SECRET
const TOKEN_TTL = JWT_TTL
const RESET_TOKEN_TTL = '30m'
const MIN_PASSWORD_LENGTH = 8

// ── Login ────────────────────────────────────────────────────────────────────
async function login(username, password) {
  const users = await loadUsersPersistent()
  const user = users[username.toLowerCase()]
  if (!user) throw new Error('Usuario no encontrado')
  if (user.disabled) throw new Error('Usuario deshabilitado')

  const ok = await bcrypt.compare(password, user.password)
  if (!ok) throw new Error('Contraseña incorrecta')

  const payload = {
    username: username.toLowerCase(),
    name: user.name,
    role: user.role,           // 'supervisor' | 'operator'
    ownerId: user.ownerId,     // HubSpot owner ID
    sipExtension: user.sipExtension || '',  // Zadarma SIP extension
    bp_paises: Array.isArray(user.bp_paises) ? user.bp_paises : [],  // Países BePharma asignados al operador
    canToggleView: user.canToggleView !== false,  // false = solo vista supervisor, sin toggle a vista operador
    defaultView: user.defaultView || null  // vista con la que debe arrancar al iniciar sesión (ej. 'operator')
  }

  const token = jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL })
  return { token, user: payload }
}

// ── Recuperar / cambiar contraseña ───────────────────────────────────────────
// El token de reset lleva un fragmento del hash de la contraseña ACTUAL
// (pwv = "password version"). Al validar el token se compara ese fragmento
// contra el hash vigente en ese momento: si la contraseña ya cambió (porque
// el link se usó, o se cambió por otra vía), el fragmento ya no coincide y el
// token queda invalidado solo, sin necesitar guardar/borrar tokens en disco.
function pwVersion(hash) {
  return (hash || '').slice(-12)
}

function validatePasswordStrength(newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
  }
}

// Genera el token de un solo uso para el link de "recuperar contraseña".
// Lanza si el username no existe -- el caller (route) decide si responde
// generico para no filtrar qué usuarios existen.
async function generateResetToken(username) {
  const users = await loadUsersPersistent()
  const user = users[username.toLowerCase()]
  if (!user) throw new Error('Usuario no encontrado')

  const token = jwt.sign(
    { username: username.toLowerCase(), purpose: 'reset', pwv: pwVersion(user.password) },
    SECRET,
    { expiresIn: RESET_TOKEN_TTL }
  )
  return { token, user }
}

// Aplica una nueva contraseña usando un token de reset válido.
async function resetPasswordWithToken(token, newPassword) {
  validatePasswordStrength(newPassword)

  let decoded
  try {
    decoded = jwt.verify(token, SECRET)
  } catch {
    throw new Error('El link para restablecer la contraseña expiró o no es válido')
  }
  if (decoded.purpose !== 'reset') throw new Error('Token inválido')

  const users = await loadUsersPersistent()
  const user = users[decoded.username]
  if (!user) throw new Error('Usuario no encontrado')
  if (pwVersion(user.password) !== decoded.pwv) {
    throw new Error('Este link ya fue usado. Solicita uno nuevo.')
  }

  user.password = await bcrypt.hash(newPassword, 10)
  await saveUsersPersistent(users)
  return { username: decoded.username }
}

// Cambio de contraseña por el propio usuario ya autenticado (requiere la actual).
async function changePassword(username, currentPassword, newPassword) {
  validatePasswordStrength(newPassword)

  const users = await loadUsersPersistent()
  const user = users[username.toLowerCase()]
  if (!user) throw new Error('Usuario no encontrado')

  const ok = await bcrypt.compare(currentPassword, user.password)
  if (!ok) throw new Error('La contraseña actual no es correcta')

  user.password = await bcrypt.hash(newPassword, 10)
  await saveUsersPersistent(users)
  return { username: username.toLowerCase() }
}

// ── Gestión de usuarios (Admin) ──────────────────────────────────────────────
// El alta/edición vive aquí y no en las rutas porque necesita el mismo bcrypt y
// las mismas reglas de contraseña que login()/changePassword().
const USERNAME_RE = /^[a-z0-9._-]{3,20}$/
const ROLES = ['supervisor', 'operator']

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase()
}

function validatePaises(bp_paises) {
  if (bp_paises === undefined) return []
  if (!Array.isArray(bp_paises) || !bp_paises.every(p => typeof p === 'string')) {
    throw new Error('bp_paises debe ser un array de strings')
  }
  return bp_paises
}

// Vista "segura" de un usuario para las respuestas del API: nunca sale el hash
// de la contraseña ni las credenciales SMTP.
function publicUser(username, u) {
  return {
    username,
    name: u.name,
    role: u.role,
    ownerId: u.ownerId,
    sipExtension: u.sipExtension || '',
    bp_paises: Array.isArray(u.bp_paises) ? u.bp_paises : [],
    emailUser: u.emailUser || '',
    disabled: !!u.disabled,
  }
}

// La contraseña inicial la define el supervisor al dar de alta y se la comunica
// al usuario, que puede cambiarla después con changePassword().
async function createUser({ username, name, role, ownerId, sipExtension, bp_paises, password }) {
  const uname = normalizeUsername(username)
  if (!USERNAME_RE.test(uname)) {
    throw new Error('El usuario debe tener entre 3 y 20 caracteres: minúsculas, números, punto, guion o guion bajo')
  }
  if (!String(name || '').trim()) throw new Error('El nombre es obligatorio')
  if (!ROLES.includes(role)) throw new Error('Rol inválido')
  validatePasswordStrength(password)
  const paises = validatePaises(bp_paises)

  const users = await loadUsersPersistent()
  if (users[uname]) throw new Error('Ya existe un usuario con ese nombre de usuario')

  users[uname] = {
    name: String(name).trim(),
    role,
    ownerId: String(ownerId || '').trim(),
    bp_paises: paises,
    sipExtension: String(sipExtension || '').trim(),
    password: await bcrypt.hash(password, 10),
    emailUser: '',
    emailPass: '',
  }
  await saveUsersPersistent(users)
  return publicUser(uname, users[uname])
}

// Solo datos básicos. El username es inmutable: es la clave de las variables
// EMAIL_USER_<USERNAME> del .env y de todo lo ya guardado bajo ese nombre.
// La contraseña y el estado activo/inactivo tienen sus propias funciones.
async function updateUser(username, patch = {}) {
  const uname = normalizeUsername(username)
  const users = await loadUsersPersistent()
  const user = users[uname]
  if (!user) throw new Error('Usuario no encontrado')

  if (patch.name !== undefined) {
    if (!String(patch.name).trim()) throw new Error('El nombre es obligatorio')
    user.name = String(patch.name).trim()
  }
  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role)) throw new Error('Rol inválido')
    user.role = patch.role
  }
  if (patch.ownerId !== undefined) user.ownerId = String(patch.ownerId || '').trim()
  if (patch.sipExtension !== undefined) user.sipExtension = String(patch.sipExtension || '').trim()
  if (patch.bp_paises !== undefined) user.bp_paises = validatePaises(patch.bp_paises)

  await saveUsersPersistent(users)
  return publicUser(uname, user)
}

// Activa/desactiva el acceso al sistema. login() ya respeta el flag, pero un
// token ya emitido sigue siendo válido hasta que expira (JWT_TTL, 8h):
// desactivar impide volver a entrar, no cierra la sesión que esté abierta.
// No se borran usuarios — desactivar preserva la trazabilidad del ownerId de
// HubSpot en los registros históricos.
async function setUserDisabled(username, disabled) {
  const uname = normalizeUsername(username)
  const users = await loadUsersPersistent()
  const user = users[uname]
  if (!user) throw new Error('Usuario no encontrado')

  // Nunca dejar el sistema sin nadie que pueda administrarlo.
  if (disabled && user.role === 'supervisor') {
    const otrosActivos = Object.entries(users)
      .filter(([n, u]) => n !== uname && u.role === 'supervisor' && !u.disabled)
    if (otrosActivos.length === 0) throw new Error('No puedes desactivar al último supervisor activo')
  }

  user.disabled = !!disabled
  await saveUsersPersistent(users)
  return publicUser(uname, user)
}

// Reset hecho por un supervisor: no pide la contraseña actual (a diferencia de
// changePassword). Invalida cualquier link de "olvidé mi contraseña" pendiente,
// porque el pwv del token deja de coincidir con el hash nuevo.
async function adminSetPassword(username, newPassword) {
  validatePasswordStrength(newPassword)
  const uname = normalizeUsername(username)
  const users = await loadUsersPersistent()
  const user = users[uname]
  if (!user) throw new Error('Usuario no encontrado')

  user.password = await bcrypt.hash(newPassword, 10)
  await saveUsersPersistent(users)
  return { username: uname }
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
// translate: se mantiene por compatibilidad de la firma, pero YA NO reemplaza
//   el label en español por su equivalente en inglés — se confirmó (04-jul-2026,
//   validación de conteos por operador) que la propiedad 'country' de
//   empresas/contactos en HubSpot está guardada en ESPAÑOL (ej. "España",
//   "Estados Unidos", "México"), igual que bp_paises, NO en inglés como decía
//   el comentario original de labelsToEnglish(). Traducir a inglés hacía que
//   cualquier país cuyo nombre difiera entre idiomas (España→Spain, Estados
//   Unidos→United States, Alemania→Germany, etc., no solo un acento) dejara
//   de matchear — le borraba a cada operador la mayoría de sus empresas reales
//   (ej. Sara: 234 con la traducción vs 1,360 reales sin ella). Ahora se
//   filtra SIEMPRE por el label en español (el valor real) y, cuando
//   translate=true, se agrega ADEMÁS la variante en inglés por si algún
//   registro puntual (enriquecido por Apollo/RocketReach) quedó en inglés —
//   así no se pierde ningún caso real ni se reintroduce el bug original.
// Si el operador no tiene países asignados, no se agrega ningún filtro
// (comportamiento igual al actual, sin restricción) para no dejar a nadie
// sin ver nada por una configuración incompleta.
function applyCountryFilter(req, filterGroups, propertyName, { translate = false } = {}) {
  if (!isActingAsOperator(req)) return filterGroups
  const paises = req.user?.bp_paises
  if (!Array.isArray(paises) || paises.length === 0) return filterGroups
  const values = translate ? [...new Set([...paises, ...labelsToEnglish(paises)])] : paises
  return addFilterToGroups(filterGroups, {
    propertyName,
    operator: 'IN',
    values
  })
}

module.exports = {
  login,
  requireAuth,
  applyOwnerFilter,
  applyCountryFilter,
  addFilterToGroups,
  generateResetToken,
  resetPasswordWithToken,
  changePassword,
  createUser,
  updateUser,
  setUserDisabled,
  adminSetPassword,
}
