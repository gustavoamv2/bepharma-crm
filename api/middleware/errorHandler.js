const { NODE_ENV } = require('../config/env')

// Error handler global. Normaliza todos los errores al formato { data, meta, error }.
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500
  const code = err.code || 'INTERNAL_ERROR'
  const message = err.message || 'Error interno del servidor'

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.path}`, err)
  }

  res.status(status).json({
    data: null,
    meta: { requestId: req.id || null },
    error: {
      code,
      message: NODE_ENV === 'production' && status >= 500 ? 'Error interno del servidor' : message
    }
  })
}

module.exports = { errorHandler }
