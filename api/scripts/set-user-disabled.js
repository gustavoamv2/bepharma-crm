// Script: habilita/deshabilita el login de un usuario, directo en el store
// (users.json local + Redis/Upstash si está configurado).
//
// Por qué existe (24-jul-2026): Gustavo pidió desactivar a Angel para que no
// pueda entrar más al CRM. No había ningún campo "disabled" -- se agregó:
//   - api/auth.js: login() ahora corta con error si user.disabled === true
//     (antes de comparar la contraseña).
//   - api/users.json: angel quedó con "disabled": true (fallback local/bundle).
// Ese campo en users.json del repo NO alcanza para producción: usersStore.js
// prioriza Redis/Upstash sobre el JSON del bundle si KV_REST_API_URL/TOKEN
// están configuradas (lo están en prod), y esas credenciales viven en
// .vercel/.env.production.local, no en el .env local -- por eso este script
// carga ambos archivos, igual que set-user-password.js.
//
// OJO: el check de "disabled" solo existe en el código nuevo de auth.js.
// Para que el bloqueo sea efectivo hacen falta LOS DOS pasos:
//   1) correr este script (aplica el flag en Redis/Upstash de inmediato)
//   2) deployar (DEPLOY.ps1) para que el servidor tenga el chequeo de login
// El orden no importa, pero si solo hacés uno de los dos, Angel todavía va
// a poder entrar.
//
// Limitación conocida: si Angel ya tiene una sesión abierta (token JWT
// vigente, dura hasta 8h), ese token sigue funcionando hasta que expire --
// este chequeo solo corre en el login, no en cada request. Si hace falta
// cortarlo YA (no solo bloquear logins futuros), avisale que le va a
// cambiar el comportamiento y considerá rotar JWT_SECRET (eso invalida
// TODAS las sesiones de TODOS los usuarios, no solo la de Angel).
//
// Como correrlo (desde tu máquina, con internet real):
//   cd bepharma-crm
//   node api/scripts/set-user-disabled.js angel --disable --dry-run
//   node api/scripts/set-user-disabled.js angel --disable --confirm
//   node api/scripts/set-user-disabled.js angel --enable --confirm

const path = require('path')
require('dotenv').config() // .env local (HubSpot, Zadarma, JWT_SECRET, etc.)
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.vercel', '.env.production.local'),
}) // agrega KV_REST_API_URL / KV_REST_API_TOKEN de producción (no pisa lo ya cargado)

const { loadUsersPersistent, saveUsersPersistent, kvEnabled } = require('../usersStore')

const args = process.argv.slice(2)
const username = args.find(a => !a.startsWith('--'))
const CONFIRM = args.includes('--confirm')
const DISABLE = args.includes('--disable')
const ENABLE = args.includes('--enable')

async function main() {
  if (!username || (!DISABLE && !ENABLE) || (DISABLE && ENABLE)) {
    console.error('Uso: node api/scripts/set-user-disabled.js <username> --disable|--enable --confirm')
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

  const newValue = DISABLE
  console.log(`Usuario: ${key} (${user.name})`)
  console.log(`Estado actual: ${user.disabled ? 'deshabilitado' : 'habilitado'}`)
  console.log(`Estado nuevo:   ${newValue ? 'deshabilitado' : 'habilitado'}`)
  console.log(`Redis/Upstash configurado: ${kvEnabled() ? 'SÍ (se actualizará producción)' : 'NO (solo se actualizará el users.json local)'}`)
  console.log(CONFIRM ? 'Modo: CONFIRM -- se va a guardar el cambio' : 'Modo: DRY-RUN -- no se guarda nada, agregá --confirm para aplicar')

  if (!CONFIRM) {
    console.log('Nada guardado todavía. Corré de nuevo con --confirm para aplicar el cambio.')
    return
  }

  user.disabled = newValue
  await saveUsersPersistent(users)
  console.log(`✔ Usuario "${key}" quedó ${newValue ? 'DESHABILITADO' : 'HABILITADO'}.`)
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
