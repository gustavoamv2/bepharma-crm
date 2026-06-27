const crypto = require('crypto')
const { ZADARMA_WEBHOOK_TOKEN } = require('../config/env')

// Protege webhooks publicos con token en header x-bepharma-webhook-token.
// Si ZADARMA_WEBHOOK_TOKEN no esta configurado, permite paso pero loguea advertencia.
function requireWebhookToken(req, res, next) {
  if (!ZADARMA_WEBHOOK_TOKEN) {
    console.error('[webhook] ZADARMA_WEBHOOK_TOKEN no configurado — rechazando solicitud')
    return res.status(503).json({ error: 'Webhook no configurado' })
  }
  const provided = req.headers['x-bepharma-webhook-token'] || ''
  const expected = ZADARMA_WEBHOOK_TOKEN
  // Comparacion timing-safe para evitar timing attacks
  if (provided.length !== expected.length) {
    return res.status(401).json({ error: 'Token invalido' })
  }
  const match = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  if (!match) {
    return res.status(401).json({ error: 'Token invalido' })
  }
  next()
}

module.exports = { requireWebhookToken }
