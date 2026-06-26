import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { hubspot } from '../hooks/useApi'

const DEAL_STAGES = {
  appointmentscheduled: 'Cita agendada',
  qualifiedtobuy: 'Calificado',
  presentationscheduled: 'Presentación',
  decisionmakerboughtin: 'DM Aprobó',
  contractsent: 'Contrato enviado',
  closedwon: 'Ganado ✅',
  closedlost: 'Perdido ❌',
}

export default function GlobalSearch() {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ deals: [], contacts: [], companies: [] })
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Abrir con Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Focus al abrir
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setResults({ deals: [], contacts: [], companies: [] })
      setSelectedIdx(0)
    }
  }, [open])

  // Buscar con debounce
  const search = useCallback(async (q) => {
    if (!q.trim()) {
      setResults({ deals: [], contacts: [], companies: [] })
      return
    }
    setLoading(true)
    try {
      const makeFilter = (prop) => ({
        filters: [{ propertyName: prop, operator: 'CONTAINS_TOKEN', value: q }],
        limit: 5,
        properties: undefined,
      })

      const [dealsRes, contactsRes, companiesRes] = await Promise.allSettled([
        hubspot.searchDeals({ filters: [{ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: q }], limit: 5 }),
        hubspot.searchContacts({ filters: [{ propertyName: 'lastname', operator: 'CONTAINS_TOKEN', value: q }], limit: 5 }),
        hubspot.searchCompanies({ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: q }], limit: 5 }),
      ])

      setResults({
        deals:     dealsRes.status === 'fulfilled'     ? (dealsRes.value.results || [])     : [],
        contacts:  contactsRes.status === 'fulfilled'  ? (contactsRes.value.results || [])  : [],
        companies: companiesRes.status === 'fulfilled' ? (companiesRes.value.results || []) : [],
      })
      setSelectedIdx(0)
    } catch {
      // fail silently
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInput = (e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val), 350)
  }

  // Flatten all results for keyboard nav
  const allItems = [
    ...results.deals.map(d => ({ type: 'deal', id: d.id, name: d.properties.dealname || '(sin nombre)', sub: DEAL_STAGES[d.properties.dealstage] || d.properties.dealstage || '' })),
    ...results.contacts.map(c => ({ type: 'contact', id: c.id, name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim() || '(sin nombre)', sub: c.properties.email || c.properties.jobtitle || '' })),
    ...results.companies.map(co => ({ type: 'company', id: co.id, name: co.properties.name || '(sin nombre)', sub: co.properties.domain || co.properties.city || '' })),
  ]

  const ICONS = { deal: '🏢', contact: '👤', company: '🏭' }
  const PATHS = { deal: '/deals', contact: '/contacts', company: '/companies' }

  const goTo = (item) => {
    nav(`${PATHS[item.type]}/${item.id}`)
    setOpen(false)
  }

  // Keyboard nav
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && allItems[selectedIdx]) {
      goTo(allItems[selectedIdx])
    }
  }

  const totalCount = allItems.length
  const hasQuery = query.trim().length > 0

  const groupStart = {
    deal:    0,
    contact: results.deals.length,
    company: results.deals.length + results.contacts.length,
  }

  if (!open) return null

  return (
    <div className="gsearch-overlay" onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="gsearch-box" onKeyDown={handleKeyDown}>
        {/* Input */}
        <div className="gsearch-input-wrap">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={handleInput}
            placeholder="Buscar deals, contactos, empresas…"
          />
          {loading && (
            <span style={{ fontSize: 11, color: '#aaa', whiteSpace: 'nowrap' }}>Buscando…</span>
          )}
        </div>

        {/* Results */}
        <div className="gsearch-results">
          {!hasQuery && (
            <div className="gsearch-empty">Escribe para buscar en todo el CRM</div>
          )}

          {hasQuery && !loading && totalCount === 0 && (
            <div className="gsearch-empty">Sin resultados para «{query}»</div>
          )}

          {results.deals.length > 0 && (
            <>
              <div className="gsearch-group-label">💼 Eventos</div>
              {results.deals.map((d, i) => {
                const idx = groupStart.deal + i
                const item = allItems[idx]
                return (
                  <div
                    key={d.id}
                    className={`gsearch-item${selectedIdx === idx ? ' selected' : ''}`}
                    onClick={() => goTo(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="gi-icon">🏢</span>
                    <div>
                      <div className="gi-name">{item.name}</div>
                      {item.sub && <div className="gi-sub">{item.sub}</div>}
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {results.contacts.length > 0 && (
            <>
              <div className="gsearch-group-label">👤 Contactos</div>
              {results.contacts.map((c, i) => {
                const idx = groupStart.contact + i
                const item = allItems[idx]
                return (
                  <div
                    key={c.id}
                    className={`gsearch-item${selectedIdx === idx ? ' selected' : ''}`}
                    onClick={() => goTo(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="gi-icon">👤</span>
                    <div>
                      <div className="gi-name">{item.name}</div>
                      {item.sub && <div className="gi-sub">{item.sub}</div>}
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {results.companies.length > 0 && (
            <>
              <div className="gsearch-group-label">🏭 Empresas</div>
              {results.companies.map((co, i) => {
                const idx = groupStart.company + i
                const item = allItems[idx]
                return (
                  <div
                    key={co.id}
                    className={`gsearch-item${selectedIdx === idx ? ' selected' : ''}`}
                    onClick={() => goTo(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="gi-icon">🏭</span>
                    <div>
                      <div className="gi-name">{item.name}</div>
                      {item.sub && <div className="gi-sub">{item.sub}</div>}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Hints */}
        <div className="gsearch-hint">
          <span><kbd>↑↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  )
}
