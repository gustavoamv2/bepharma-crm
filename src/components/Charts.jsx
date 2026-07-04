import React, { useState } from 'react'

// Gráficas SVG compartidas (extraídas de Dashboard.jsx el 04-jul-2026 para
// reusarlas también en CompanyList.jsx y DealList.jsx sin duplicar código).

// Parte una etiqueta larga en hasta 2 líneas (por palabra completa) para que
// se lea entera bajo la barra en vez de truncarse con "…".
function wrapLabel(label, maxCharsPerLine = 10) {
  const words = (label || '').split(' ')
  const lines = []
  let cur = ''
  words.forEach(w => {
    const test = cur ? `${cur} ${w}` : w
    if (test.length > maxCharsPerLine && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = test
    }
  })
  if (cur) lines.push(cur)
  if (lines.length > 2) {
    lines[1] = lines.slice(1).join(' ')
    lines.length = 2
  }
  return lines
}

// ── Gráfica de barras SVG (interactiva) ──────────────────────────────────────
// data: [{ key, label, count }]
export function BarChart({ data, color = '#4fc3f7', height = 140, onBarClick }) {
  const [hovered, setHovered] = useState(null)
  if (!data?.length) return null
  const max = Math.max(...data.map(d => d.count), 1)
  const W = 340, H = height + 12, PL = 8, PR = 8, PT = 20, PB = 44
  const cW = W - PL - PR
  const cH = H - PT - PB
  const slot = cW / data.length
  const bW = Math.min(slot * 0.65, 36)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }}>
      {[0.25, 0.5, 0.75, 1].map(p => {
        const y = PT + cH * (1 - p)
        return <line key={p} x1={PL} y1={y} x2={W - PR} y2={y} stroke="#e2e8f0" strokeWidth={1} />
      })}
      {data.map((d, i) => {
        const bH = Math.max((d.count / max) * cH, d.count > 0 ? 4 : 0)
        const x = PL + i * slot + (slot - bW) / 2
        const y = PT + cH - bH
        const isHovered = hovered === i
        const barColor = d.color || color
        return (
          <g key={i}
            style={{ cursor: onBarClick && d.count > 0 ? 'pointer' : 'default' }}
            onClick={() => d.count > 0 && onBarClick?.(d)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <rect x={x} y={y} width={bW} height={bH} rx={3}
              fill={isHovered ? '#0041a8' : barColor}
              opacity={isHovered ? 1 : 0.85}
              style={{ transition: 'fill .1s' }}
            />
            {d.count > 0 && (
              <text x={x + bW / 2} y={y - 4} textAnchor="middle" fontSize={10} fontWeight="600" fill={barColor}>{d.count}</text>
            )}
            {wrapLabel(d.label).map((line, li, arr) => (
              <text key={li} x={x + bW / 2} y={H - 6 - (arr.length - 1 - li) * 11} textAnchor="middle" fontSize={9} fill="#6b778c">
                {line}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

// ── Gráfica donut SVG (interactiva) ──────────────────────────────────────────
// data: [{ key, label, count, color }]
export function DonutChart({ data, onSliceClick, centerLabel = '', defaultColor = '#607d8b' }) {
  const [hovered, setHovered] = useState(null)
  if (!data?.length) return null
  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return <div style={{ fontSize: 12, color: '#6b778c', padding: 20, textAlign: 'center' }}>Sin datos</div>

  const R = 48, cx = 64, cy = 64, strokeW = 22
  let angle = -90

  const slices = data
    .filter(d => d.count > 0)
    .map(d => {
      const start = angle
      const sweep = (d.count / total) * 360
      angle += sweep
      return { ...d, start, sweep }
    })

  const arcPath = (cx, cy, R, start, sweep) => {
    const r = (a) => (a * Math.PI) / 180
    const x1 = cx + R * Math.cos(r(start))
    const y1 = cy + R * Math.sin(r(start))
    const x2 = cx + R * Math.cos(r(start + sweep))
    const y2 = cy + R * Math.sin(r(start + sweep))
    return `M ${x1} ${y1} A ${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <svg viewBox="0 0 128 128" style={{ width: 128, height: 128, flexShrink: 0 }}>
        {slices.map((s, i) => (
          <path key={i}
            d={arcPath(cx, cy, R, s.start, s.sweep)}
            fill="none"
            stroke={s.color || defaultColor}
            strokeWidth={hovered === i ? strokeW + 4 : strokeW}
            strokeLinecap="butt"
            style={{ cursor: onSliceClick ? 'pointer' : 'default', transition: 'stroke-width .1s' }}
            onClick={() => onSliceClick?.(s)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={18} fontWeight="700" fill="#172b4d">{total}</text>
        {centerLabel && <text x={cx} y={cx + 10} textAnchor="middle" fontSize={9} fill="#6b778c">{centerLabel}</text>}
      </svg>
      <div style={{ flex: '0 1 auto', maxWidth: 200, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {slices.map((s, i) => (
          <div key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
              cursor: onSliceClick ? 'pointer' : 'default',
              opacity: hovered === null || hovered === i ? 1 : 0.5,
              transition: 'opacity .1s'
            }}
            onClick={() => onSliceClick?.(s)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color || defaultColor, flexShrink: 0 }} />
            <span style={{ color: '#6b778c', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ fontWeight: 600, color: '#172b4d', marginLeft: 'auto' }}>{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
