// Valida variables de entorno criticas al inicio.
// El servidor falla en arranque si faltan; no existen fallbacks inseguros.
const REQUIRED = ['JWT_SECRET', 'HUBSPOT_ACCESS_TOKEN']

for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`[env] Variable requerida no configurada: ${key}`)
    process.exit(1)
  }
}

module.exports = {
  PORT: process.env.PORT || 3001,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_TTL: '8h',
  HUBSPOT_ACCESS_TOKEN: process.env.HUBSPOT_ACCESS_TOKEN,
  APP_ORIGIN: process.env.APP_ORIGIN || 'http://localhost:5173',
  ZADARMA_WEBHOOK_TOKEN: process.env.ZADARMA_WEBHOOK_TOKEN || null,
  NODE_ENV: process.env.NODE_ENV || 'development',
}
