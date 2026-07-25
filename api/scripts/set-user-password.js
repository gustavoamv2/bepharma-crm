// Script: cambia la contraseña de un usuario directamente en el store
// (users.json local + Redis/Upstash si está configurado), sin pasar por login.
//
// Por qué existe (14-jul-2026): Gustavo pidió cambiar la contraseña de Roberto.
// No hay endpoint admin para resetear la contraseña de OTRO usuario -- solo
// existen los flujos self-service /forgot-password (requiere EMAIL_USER_<user>
// configurado, que Roberto no tiene) y /change-password (requiere la
// contraseña actual). Este script hace lo mismo que hace api/auth.js
// internamente: bcrypt.hash(nueva, 10) + saveUsersPersistent(users), que
// escribe tanto en api/users.json como en Redis/Upstash (ver api/usersStore.js).
//
// IMPORTANTE: para que el cambio se refleje en PRODUCCIÓN (no solo en el
// users.json del repo) hace falta que KV_REST_API_URL / KV_REST_API_TOKEN
// estén disponibles al correr el script. Esas variables NO están en el .env
// local (solo trae HubSpot/Zadarma/etc.) pero SÍ están en
// .vercel/.env.production.local (las que usa Vercel en prod) -- por eso este
// script carga ambos archivos.
//
// Como correrlo (desde tu máquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/set-user-password.js roberto "Mexico2026**" --dry-run
//   node api/scripts/set-user-password.js roberto "Mexico2026**" --confirm

const path = require('path')
require('dotenv').config() // .env local (HubSpot, Zadarma, JWT_SECRET, etc.)
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.vercel', '.env.production.local'),
}) // agrega KV_REST_API_URL / KV_REST_API_TOKEN de producción (no pisa lo ya cargado)

const bcrypt = require('bcryptjs')
const { loadUsersPersistent, saveUsersPersistent, kvEnabled } = require('../usersStore')

const [, , username, newPassword, flag] = process.argv
const CONFIRM = flag === '--confirm'
const MIN_PASSWORD_LENGTH = 8

async function main() {
  if (!username || !newPassword) {
    console.error('Uso: node api/scripts/set-user-password.js <username> <nuevaPassword> --confirm')
    process.exit(1)
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    console.error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
    process.exit(1)
  }

  const users = await loadUsersPersistent()
  const key = username.toLowerCase()
  const user = users[key]
  if (!user) {
    console.error(`Usuario "${username}" no encontrado en users.json`)
    console.error('Usuarios disponibles:', Object.keys(users).join(', '))
    process.exit(1)
  }

  console.log(`Usuario: ${key} (${user.name})`)
  console.log(`Redis/Upstash configurado: ${kvEnabled() ? 'SÍ (se actualizará producción)' : 'NO (solo se actualizará el users.json local)'}`)
  console.log(CONFIRM ? 'Modo: CONFIRM -- se va a guardar el cambio' : 'Modo: DRY-RUN -- no se guarda nada, agregá --confirm para aplicar')

  if (!CONFIRM) {
    console.log('Nada guardado todavía. Corré de nuevo con --confirm para aplicar el cambio.')
    return
  }

  user.password = await bcrypt.hash(newPassword, 10)
  await saveUsersPersistent(users)
  console.log(`✔ Contraseña de "${key}" actualizada correctamente.`)
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
