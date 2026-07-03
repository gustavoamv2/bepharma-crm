import React from 'react'

const STAGES = {
  nueva:               { label: 'Nueva',               cls: 'badge-blue' },
  en_depuracion:       { label: 'En Depuración',       cls: 'badge-yellow' },
  en_enriquecimiento:  { label: 'En Enriquecimiento',  cls: 'badge-purple' },
  contacto_enviado:    { label: 'Por Contactar',        cls: 'badge-blue' },
  en_seguimiento:      { label: 'En Seguimiento',       cls: 'badge-blue' },
  confirmada:          { label: 'Confirmada',           cls: 'badge-green' },
  no_participa:        { label: 'No Participa',         cls: 'badge-red' },
}

export default function DealStageBadge({ stage }) {
  const s = STAGES[stage] || { label: stage || '—', cls: 'badge-gray' }
  return <span className={`badge ${s.cls}`}>{s.label}</span>
}
