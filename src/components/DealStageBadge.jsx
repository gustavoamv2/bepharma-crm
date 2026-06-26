import React from 'react'

const STAGES = {
  appointmentscheduled: { label: 'Cita agendada', cls: 'badge-blue' },
  qualifiedtobuy: { label: 'Calificado', cls: 'badge-purple' },
  presentationscheduled: { label: 'Presentación', cls: 'badge-blue' },
  decisionmakerboughtin: { label: 'Decision maker', cls: 'badge-yellow' },
  contractsent: { label: 'Contrato enviado', cls: 'badge-yellow' },
  closedwon: { label: 'Ganado ✓', cls: 'badge-green' },
  closedlost: { label: 'Perdido', cls: 'badge-red' },
}

export default function DealStageBadge({ stage }) {
  const s = STAGES[stage] || { label: stage || '—', cls: 'badge-gray' }
  return <span className={`badge ${s.cls}`}>{s.label}</span>
}
