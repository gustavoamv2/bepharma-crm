import React from 'react'

const STAGES = {
  nueva_empresa:       { label: 'Nueva empresa',       cls: 'badge-blue' },
  en_depuracion:       { label: 'En depuracion',       cls: 'badge-yellow' },
  en_enriquecimiento:  { label: 'En enriquecimiento',  cls: 'badge-purple' },
  contacto_enviado:    { label: 'Contacto enviado',     cls: 'badge-blue' },
  en_seguimiento:      { label: 'En seguimiento',       cls: 'badge-blue' },
  confirmada_bepharma: { label: 'Confirmada BePharma',  cls: 'badge-green' },
  no_participa:        { label: 'No participa',         cls: 'badge-red' },
}

export default function DealStageBadge({ stage }) {
  const s = STAGES[stage] || { label: stage || '—', cls: 'badge-gray' }
  return <span className={`badge ${s.cls}`}>{s.label}</span>
}
