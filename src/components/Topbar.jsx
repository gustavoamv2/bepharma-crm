import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

export default function Topbar({ title, back, action }) {
  const nav = useNavigate()
  return (
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {back && (
          <button className="btn btn-ghost btn-sm" onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronLeft size={14} /> Volver
          </button>
        )}
        <h1>{title}</h1>
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
