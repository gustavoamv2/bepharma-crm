import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from 'react-query'
import { X, Search } from 'lucide-react'
import { hubspot, invalidateDashboard } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { COUNTRIES, COUNTRY_LABELS, COUNTRY_EN_BY_LABEL } from '../constants/countries'

// ── Autocomplete genérico ──────────────────────────────────────────────────────
function AutocompleteField({ value, onChange, options = [], placeholder, hasError }) {
  const [query, setQuery]         = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen]           = useState(false)
  const wrapRef                   = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filter = (q) => {
    const lq = q.trim().toLowerCase()
    return lq ? options.filter(o => o.toLowerCase().includes(lq)) : options
  }

  const handleFocus = () => {
    const filtered = filter(query)
    setSuggestions(filtered.slice(0, 80))
    setOpen(filtered.length > 0)
  }

  const handleInput = (e) => {
    const v = e.target.value
    setQuery(v)
    onChange(v)
    const filtered = filter(v)
    setSuggestions(filtered.slice(0, 80))
    setOpen(filtered.length > 0)
  }

  const handleSelect = (opt) => {
    setQuery(opt)
    onChange(opt)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={handleFocus}
        placeholder={placeholder || ''}
        style={inputStyle(hasError)}
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #dfe1e6', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.15)', maxHeight: 220, overflowY: 'auto'
        }}>
          {suggestions.map(opt => (
            <div key={opt} onMouseDown={() => handleSelect(opt)}
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f4f5f7' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f4f5f7'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Autocomplete de ciudades (carga según país) ────────────────────────────────
function CityAutocompleteField({ value, onChange, countryLabel, placeholder, hasError }) {
  const [query, setQuery]         = useState(value || '')
  const [cities, setCities]       = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen]           = useState(false)
  const [loading, setLoading]     = useState(false)
  const wrapRef                   = useRef(null)
  const loadedCountry             = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Cargar ciudades cuando cambia el país seleccionado
  useEffect(() => {
    const enName = COUNTRY_EN_BY_LABEL[countryLabel]
    if (!enName || enName === loadedCountry.current) return
    loadedCountry.current = enName
    setLoading(true)
    setCities([])
    fetch('https://countriesnow.space/api/v0.1/countries/cities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: enName })
    })
      .then(r => r.json())
      .then(d => setCities(d.data || []))
      .catch(() => setCities([]))
      .finally(() => setLoading(false))
  }, [countryLabel])

  const filter = (q) => {
    const lq = q.trim().toLowerCase()
    return lq ? cities.filter(c => c.toLowerCase().includes(lq)) : cities
  }

  const handleFocus = () => {
    const filtered = filter(query)
    setSuggestions(filtered.slice(0, 80))
    setOpen(filtered.length > 0)
  }

  const handleInput = (e) => {
    const v = e.target.value
    setQuery(v)
    onChange(v)
    const filtered = filter(v)
    setSuggestions(filtered.slice(0, 80))
    setOpen(filtered.length > 0)
  }

  const handleSelect = (opt) => {
    setQuery(opt)
    onChange(opt)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={handleFocus}
        placeholder={loading ? 'Cargando ciudades…' : placeholder || ''}
        style={inputStyle(hasError)}
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #dfe1e6', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.15)', maxHeight: 220, overflowY: 'auto'
        }}>
          {suggestions.map(opt => (
            <div key={opt} onMouseDown={() => handleSelect(opt)}
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f4f5f7' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f4f5f7'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Schemas por tipo de objeto ─────────────────────────────────────────────────
const DEAL_FIELDS = [
  { key: 'dealname',            label: 'Nombre del evento', required: true, type: 'text' },
  { key: 'dealstage',           label: 'Etapa', required: true, type: 'select',
    options: [
      { value: 'appointmentscheduled',  label: 'Cita agendada' },
      { value: 'qualifiedtobuy',        label: 'Calificado' },
      { value: 'presentationscheduled', label: 'Presentación' },
      { value: 'decisionmakerboughtin', label: 'Decision maker aprobó' },
      { value: 'contractsent',          label: 'Contrato enviado' },
      { value: 'closedwon',             label: 'Ganado' },
      { value: 'closedlost',            label: 'Perdido' },
    ]
  },
  { key: 'amount',    label: 'Monto (USD)',   type: 'number' },
  { key: 'closedate', label: 'Fecha de cierre', type: 'date' },
  { key: 'bp_zona',   label: 'Zona BePharma', type: 'select',
    options: [
      { value: 'EEUU',        label: 'EEUU' },
      { value: 'Europa',      label: 'Europa' },
      { value: 'LATAM Norte', label: 'LATAM Norte' },
      { value: 'LATAM Sur',   label: 'LATAM Sur' },
      { value: 'Asia',        label: 'Asia' },
      { value: 'Africa',      label: 'África' },
      { value: 'Oceania',     label: 'Oceanía' },
      { value: 'Medio Oriente', label: 'Medio Oriente' },
    ]
  },
  { key: 'bp_estado_prospeccion', label: 'Estado prospección', type: 'select',
    options: [
      { value: 'nueva',              label: 'Nueva' },
      { value: 'en_depuracion',      label: 'En Depuración' },
      { value: 'en_enriquecimiento', label: 'En Enriquecimiento' },
      { value: 'contacto_enviado',   label: 'Por Contactar' },
      { value: 'en_seguimiento',     label: 'En Seguimiento' },
      { value: 'confirmada',         label: 'Confirmada' },
      { value: 'no_participa',       label: 'No Participa' },
    ]
  },
  { key: 'hs_next_step', label: 'Siguiente paso', type: 'textarea' },
  { key: 'description',  label: 'Descripción',    type: 'textarea' },
]

const COMPANY_FIELDS = [
  { key: 'name',     label: 'Nombre de la empresa', required: true, type: 'company-name-search' },
  { key: 'domain',   label: 'Dominio web',           type: 'text', placeholder: 'empresa.com' },
  { key: 'phone',    label: 'Teléfono 1',            type: 'text' },
  { key: 'bp_telefonos_adicionales', label: 'Teléfono 2', type: 'text' },
  { key: 'bp_telefono_3',            label: 'Teléfono 3', type: 'text' },
  { key: 'bp_email_empresa', label: 'Email 1', type: 'email' },
  { key: 'bp_email_2',       label: 'Email 2', type: 'email' },
  { key: 'bp_email_3',       label: 'Email 3', type: 'email' },
  // Requerido: sin país, la empresa no cae en la zona de NINGÚN operador
  // (el listado de Empresas filtra por country IN [países del operador] —
  // ver applyCountryFilter en api/auth.js) y solo la vería un supervisor.
  { key: 'country',  label: 'País', required: true,  type: 'country-autocomplete' },
  { key: 'city',     label: 'Ciudad',                type: 'city-autocomplete' },
  { key: 'industry', label: 'Industria', type: 'select', options: [
    { value: '', label: '— Seleccionar —' },
    { value: 'ACCOUNTING',                        label: 'Contabilidad' },
    { value: 'AIRLINES_AVIATION',                 label: 'Aerolíneas / Aviación' },
    { value: 'ALTERNATIVE_MEDICINE',              label: 'Medicina alternativa' },
    { value: 'APPAREL_FASHION',                   label: 'Moda / Indumentaria' },
    { value: 'ARCHITECTURE_PLANNING',             label: 'Arquitectura / Planeación' },
    { value: 'AUTOMOTIVE',                        label: 'Automotriz' },
    { value: 'BANKING',                           label: 'Banca' },
    { value: 'BIOTECHNOLOGY',                     label: 'Biotecnología' },
    { value: 'BROADCAST_MEDIA',                   label: 'Medios de comunicación' },
    { value: 'BUILDING_MATERIALS',                label: 'Materiales de construcción' },
    { value: 'CHEMICALS',                         label: 'Química' },
    { value: 'CIVIL_ENGINEERING',                 label: 'Ingeniería civil' },
    { value: 'COMPUTER_HARDWARE',                 label: 'Hardware informático' },
    { value: 'COMPUTER_SOFTWARE',                 label: 'Software' },
    { value: 'CONSTRUCTION',                      label: 'Construcción' },
    { value: 'CONSUMER_ELECTRONICS',              label: 'Electrónica de consumo' },
    { value: 'CONSUMER_GOODS',                    label: 'Bienes de consumo' },
    { value: 'COSMETICS',                         label: 'Cosméticos' },
    { value: 'DEFENSE_SPACE',                     label: 'Defensa / Espacio' },
    { value: 'EDUCATION_MANAGEMENT',              label: 'Gestión educativa' },
    { value: 'ELECTRICAL_ELECTRONIC_MANUFACTURING', label: 'Manufactura eléctrica / electrónica' },
    { value: 'ENVIRONMENTAL_SERVICES',            label: 'Servicios ambientales' },
    { value: 'EVENTS_SERVICES',                   label: 'Servicios de eventos' },
    { value: 'FINANCIAL_SERVICES',                label: 'Servicios financieros' },
    { value: 'FOOD_BEVERAGES',                    label: 'Alimentos y bebidas' },
    { value: 'FOOD_PRODUCTION',                   label: 'Producción de alimentos' },
    { value: 'GOVERNMENT_ADMINISTRATION',         label: 'Administración pública' },
    { value: 'HEALTH_WELLNESS_AND_FITNESS',       label: 'Salud y bienestar' },
    { value: 'HIGHER_EDUCATION',                  label: 'Educación superior' },
    { value: 'HOSPITAL_HEALTH_CARE',              label: 'Hospitales / Salud' },
    { value: 'HOSPITALITY',                       label: 'Hospitalidad' },
    { value: 'HUMAN_RESOURCES',                   label: 'Recursos humanos' },
    { value: 'IMPORT_AND_EXPORT',                 label: 'Importación / Exportación' },
    { value: 'INDUSTRIAL_AUTOMATION',             label: 'Automatización industrial' },
    { value: 'INFORMATION_TECHNOLOGY_AND_SERVICES', label: 'Tecnología de la información' },
    { value: 'INSURANCE',                         label: 'Seguros' },
    { value: 'INTERNATIONAL_TRADE_AND_DEVELOPMENT', label: 'Comercio internacional' },
    { value: 'INVESTMENT_MANAGEMENT',             label: 'Gestión de inversiones' },
    { value: 'LAW_PRACTICE',                      label: 'Práctica jurídica' },
    { value: 'LEGAL_SERVICES',                    label: 'Servicios legales' },
    { value: 'LOGISTICS_AND_SUPPLY_CHAIN',        label: 'Logística / Cadena de suministro' },
    { value: 'MACHINERY',                         label: 'Maquinaria' },
    { value: 'MANAGEMENT_CONSULTING',             label: 'Consultoría de gestión' },
    { value: 'MARKET_RESEARCH',                   label: 'Investigación de mercado' },
    { value: 'MARKETING_AND_ADVERTISING',         label: 'Marketing / Publicidad' },
    { value: 'MECHANICAL_OR_INDUSTRIAL_ENGINEERING', label: 'Ingeniería mecánica / industrial' },
    { value: 'MEDICAL_DEVICES',                   label: 'Dispositivos médicos' },
    { value: 'MEDICAL_PRACTICE',                  label: 'Práctica médica' },
    { value: 'MENTAL_HEALTH_CARE',                label: 'Salud mental' },
    { value: 'MINING_METALS',                     label: 'Minería / Metales' },
    { value: 'NON_PROFIT_ORGANIZATION_MANAGEMENT', label: 'Organización sin fines de lucro' },
    { value: 'OIL_ENERGY',                        label: 'Petróleo / Energía' },
    { value: 'OUTSOURCING_OFFSHORING',            label: 'Outsourcing' },
    { value: 'PACKAGING_AND_CONTAINERS',          label: 'Empaques / Contenedores' },
    { value: 'PHARMACEUTICALS',                   label: 'Farmacéutica' },
    { value: 'PRINTING',                          label: 'Impresión' },
    { value: 'PUBLIC_RELATIONS_AND_COMMUNICATIONS', label: 'Relaciones públicas' },
    { value: 'PUBLISHING',                        label: 'Editorial' },
    { value: 'REAL_ESTATE',                       label: 'Bienes raíces' },
    { value: 'RENEWABLES_ENVIRONMENT',            label: 'Energías renovables' },
    { value: 'RESEARCH',                          label: 'Investigación' },
    { value: 'RESTAURANTS',                       label: 'Restaurantes' },
    { value: 'RETAIL',                            label: 'Comercio minorista' },
    { value: 'SEMICONDUCTORS',                    label: 'Semiconductores' },
    { value: 'STAFFING_AND_RECRUITING',           label: 'Reclutamiento / Staffing' },
    { value: 'TELECOMMUNICATIONS',               label: 'Telecomunicaciones' },
    { value: 'TRANSPORTATION_TRUCKING_RAILROAD',  label: 'Transporte / Logística terrestre' },
    { value: 'UTILITIES',                         label: 'Servicios públicos' },
    { value: 'VETERINARY',                        label: 'Veterinaria' },
    { value: 'WHOLESALE',                         label: 'Mayorista' },
  ]},
  { key: 'numberofemployees', label: 'Nº empleados', type: 'number' },
  { key: 'description', label: 'Descripción',        type: 'textarea' },
  { key: 'bp_participo_eventos', label: 'Participó en Eventos', type: 'checkbox',
    icon: '📅', activeColor: '#166534', activeBg: '#f0fdf4', activeBorder: '#86efac',
    helpText: 'Marca manual — la empresa ya participó en algún evento BePharma (histórico o confirmado). No se calcula solo a partir de los deals asociados.' },
  { key: 'bp_lista_negra', label: 'Lista negra',     type: 'checkbox',
    icon: '⛔', activeColor: '#172b4d', activeBg: '#fff1f0', activeBorder: '#ffa39e',
    helpText: 'No contactar a esta empresa en futuros eventos. La empresa sigue en la base de datos, pero se marca visualmente para excluirla al armar listas de prospección.' },
]

const CONTACT_FIELDS = [
  { key: 'firstname', label: 'Nombre',    required: true, type: 'text' },
  { key: 'lastname',  label: 'Apellido',  type: 'text' },
  { key: 'email',     label: 'Email 1',   type: 'email' },
  { key: 'bp_email_2', label: 'Email 2',  type: 'email' },
  { key: 'bp_email_3', label: 'Email 3',  type: 'email' },
  { key: 'phone',     label: 'Teléfono 1 (fijo)', type: 'text' },
  { key: 'mobilephone', label: 'Teléfono 2 (móvil)', type: 'text' },
  { key: 'bp_telefono_3', label: 'Teléfono 3', type: 'text' },
  { key: 'jobtitle',  label: 'Cargo',     type: 'text' },
  { key: 'company',   label: 'Empresa',   type: 'company-search' },
  { key: 'hs_linkedin_url', label: 'LinkedIn URL', type: 'text', placeholder: 'https://linkedin.com/in/...' },
  { key: 'bp_notas_contacto', label: 'Anotaciones / Notas del contacto', type: 'textarea',
    placeholder: 'Preferencias, observaciones de llamadas, etc.' },
]

const SCHEMAS = { deal: DEAL_FIELDS, company: COMPANY_FIELDS, contact: CONTACT_FIELDS }
const TITLES  = { deal: 'evento', company: 'empresa', contact: 'contacto' }

// ── Campo de búsqueda de empresa ───────────────────────────────────────────────
function CompanySearchField({ value, onChange, onCompanySelect }) {
  const [query, setQuery] = useState(value || '')
  const [results, setResults] = useState([])
  const [allCompanies, setAllCompanies] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const debounceRef = useRef(null)
  const wrapRef = useRef(null)

  // Cargar todas las empresas al montar
  useEffect(() => {
    hubspot.quickSearchCompanies('').then(data => {
      setAllCompanies(data.results || [])
    }).catch(() => {})
  }, [])

  // Cerrar dropdown al clic fuera
  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = useCallback((q) => {
    clearTimeout(debounceRef.current)
    if (!q.trim()) {
      // Sin texto: mostrar todas las empresas cargadas
      setResults(allCompanies)
      setOpen(allCompanies.length > 0)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await hubspot.quickSearchCompanies(q)
        setResults(data.results || [])
        setOpen(true)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 300)
  }, [allCompanies])

  const handleFocus = () => {
    if (!query.trim()) {
      setResults(allCompanies)
      setOpen(allCompanies.length > 0)
    } else {
      search(query)
    }
  }

  const handleInput = (e) => {
    const v = e.target.value
    setQuery(v)
    onChange(v)
    setSelected(null)
    onCompanySelect(null)
    search(v)
  }

  const handleSelect = (company) => {
    const name = company.properties?.name || ''
    setQuery(name)
    setSelected(company.id)
    onChange(name)
    onCompanySelect(company.id)
    setOpen(false)
    setResults([])
  }

  const displayed = results.length > 0 ? results : allCompanies

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={handleFocus}
          placeholder="Busca o selecciona una empresa…"
          style={{ ...inputStyle(false), paddingRight: 32 }}
        />
        <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b778c', pointerEvents: 'none' }} />
      </div>
      {selected && (
        <div style={{ fontSize: 11, color: '#00875a', marginTop: 3 }}>✓ Empresa vinculada a HubSpot</div>
      )}
      {loading && (
        <div style={{ fontSize: 11, color: '#6b778c', marginTop: 3 }}>Buscando…</div>
      )}
      {open && displayed.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #dfe1e6', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.15)', maxHeight: 220, overflowY: 'auto'
        }}>
          {displayed.map(c => {
            const p = c.properties || {}
            return (
              <div
                key={c.id}
                onMouseDown={() => handleSelect(c)}
                style={{
                  padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f4f5f7',
                  display: 'flex', alignItems: 'center', gap: 8
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f4f5f7'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                {(p.domain || p.city) && (
                  <span style={{ fontSize: 11, color: '#6b778c' }}>
                    {[p.domain, p.city].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const DEAL_PROSPECCION_OPTIONS = [
  { value: 'nueva',            label: 'Nueva' },
  { value: 'en_depuracion',   label: 'En Depuración' },
  { value: 'en_enriquecimiento', label: 'En Enriquecimiento' },
  { value: 'contacto_enviado', label: 'Por Contactar' },
  { value: 'en_seguimiento',  label: 'En Seguimiento' },
  { value: 'confirmada',      label: 'Confirmada' },
  { value: 'no_participa',    label: 'No Participa' },
]

// Nueva/En Depuración/En Enriquecimiento/Por Contactar las asigna el CRM
// automáticamente según los datos de contacto disponibles (ver
// api/services/autoStage.service.js). Al editar un deal ya existente se
// muestran las 7 opciones (para que el valor actual siempre coincida con
// algo en el <select>), pero esas 4 quedan deshabilitadas — el operador solo
// puede avanzar manualmente a En Seguimiento/Confirmada/No Participa. Si se
// dejaran seleccionables, un cambio manual se quedaría "congelado" hasta el
// próximo cambio de datos de contacto que dispare el recálculo automático.
const AUTO_STAGE_VALUES = ['nueva', 'en_depuracion', 'en_enriquecimiento', 'contacto_enviado']
const EDIT_STAGE_OPTIONS = DEAL_PROSPECCION_OPTIONS.map(o => ({
  ...o,
  disabled: AUTO_STAGE_VALUES.includes(o.value),
}))

// Eventos BePharma programados — actualizar cuando se agenden nuevas ediciones
export const EVENTOS_PROGRAMADOS = [
  { value: 'BEPH-2026-09', label: 'Septiembre 2026 (actual)' },
  { value: 'BEPH-2027-03', label: 'Marzo 2027' },
  { value: 'BEPH-2027-09', label: 'Septiembre 2027' },
]
export const ACTIVE_EVENT = 'BEPH-2026-09'

// Campos para crear deal desde empresa (solo estado prospección)
const DEAL_FIELDS_FROM_COMPANY = [
  { key: 'dealname', label: 'Nombre del evento', required: true, type: 'text' },
  { key: 'bp_estado_prospeccion', label: 'Estado de prospección', required: true, type: 'select',
    options: DEAL_PROSPECCION_OPTIONS
  },
]

// Campos para editar deal (sin nombre ni zona — ambos son automáticos)
const DEAL_FIELDS_EDIT = [
  { key: 'bp_estado_prospeccion', label: 'Estado de la Empresa', required: true, type: 'select',
    options: EDIT_STAGE_OPTIONS,
    helpText: 'Nueva / En Depuración / En Enriquecimiento / Por Contactar las asigna el CRM automáticamente — solo puedes avanzar manualmente a En Seguimiento, Confirmada o No Participa.',
  },
  { key: 'hs_next_step', label: 'Siguiente paso', type: 'textarea' },
]

// ── Modal ──────────────────────────────────────────────────────────────────────
export default function RecordModal({ type, record, onClose, onSaved, companyId = null, companyIdForEdit = null, defaults = {} }) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const isEdit = !!record?.id

  // Selección de campos según contexto
  const fields = (() => {
    if (type === 'company') {
      // País obligatorio solo al CREAR una empresa nueva — no bloquea la
      // edición de empresas ya existentes que no lo tengan cargado (dato
      // legacy: ~297 empresas sin país detectadas en el backfill de países,
      // ver api/scripts/backfill-empresas-pais.js).
      return isEdit ? COMPANY_FIELDS.map(f => f.key === 'country' ? { ...f, required: false } : f) : COMPANY_FIELDS
    }
    if (type !== 'deal') return SCHEMAS[type] || []
    if (isEdit) return DEAL_FIELDS_EDIT           // editar: solo estado + siguiente paso
    if (companyId) return DEAL_FIELDS_FROM_COMPANY // crear desde empresa: nombre + estado
    return SCHEMAS.deal                            // crear genérico: todos los campos
  })()

  // Inicializa form: prioridad → valor actual del record → defaults → vacío
  const initial = {}
  fields.forEach(f => {
    let val = record?.properties?.[f.key] ?? defaults[f.key] ?? ''
    if (f.type === 'date' && val) val = val.slice(0, 10)
    if (f.type === 'checkbox') val = val === true || val === 'true'
    initial[f.key] = val
  })

  const [form, setForm]             = useState(initial)
  const [saving, setSaving]         = useState(false)
  const [errors, setErrors]         = useState({})
  const [selectedCompanyId, setSelectedCompanyId] = useState(null)
  // Para edición de deals: eventos seleccionados (confirmada=multi, no_participa=uno)
  const currentDealEvento = record?.properties?.bp_evento_codigo || ACTIVE_EVENT
  const [dealEventos, setDealEventos] = useState([currentDealEvento]) // checkboxes confirmada
  const [dealEvento, setDealEvento]   = useState(currentDealEvento)   // select no_participa

  const toggleDealEvento = (val) => setDealEventos(prev =>
    prev.includes(val) ? (prev.length > 1 ? prev.filter(v => v !== val) : prev) : [...prev, val]
  )

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const validate = () => {
    const errs = {}
    fields.filter(f => f.required).forEach(f => {
      if (!form[f.key]) errs[f.key] = 'Campo requerido'
    })
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    // Contacto nuevo con empresa escrita pero no seleccionada del dropdown
    if (type === 'contact' && !isEdit && form.company && !selectedCompanyId) {
      setErrors(prev => ({
        ...prev,
        company: 'La empresa no existe en HubSpot. Créala primero y luego asígnala al contacto.'
      }))
      return
    }

    setSaving(true)

    // Limpia valores vacíos; excluye campos especiales
    const props = {}
    fields.forEach(f => {
      if (f.type === 'company-search') return // handled separately
      const val = form[f.key]
      if (val !== '' && val !== null && val !== undefined) {
        props[f.key] = (f.type === 'number' || f.type === 'checkbox') ? String(val) : val
      }
    })
    // Para contactos: incluir company name, _companyId y asignar owner al usuario actual
    if (type === 'contact') {
      if (form.company) props.company = form.company
      if (selectedCompanyId) props._companyId = selectedCompanyId
      if (!isEdit && user?.ownerId) props.hubspot_owner_id = String(user.ownerId)
    }
    if (type === 'deal') {
      if (isEdit) {
        const estado = props.bp_estado_prospeccion
        if (estado === 'no_participa' && dealEvento && dealEvento !== currentDealEvento) {
          // Interesado en otro evento → mover deal y reactivar estado
          props.bp_evento_codigo = dealEvento
          props.bp_estado_prospeccion = 'en_seguimiento'
        }
      } else {
        if (companyId) props._companyId = companyId
        // Incluir defaults ocultos (ej: bp_evento_codigo)
        Object.entries(defaults).forEach(([k, v]) => {
          if (!(k in props) && v) props[k] = v
        })
        // Todo evento nuevo debe quedar en el evento que se está prospectando
        // actualmente (BEPH-2026-09) por defecto — no depende de que quien
        // abra el modal se acuerde de pasar `defaults.bp_evento_codigo`, así
        // cualquier punto de creación de deals (presente o futuro) lo hereda.
        if (!props.bp_evento_codigo) props.bp_evento_codigo = ACTIVE_EVENT
      }
    }

    try {
      let result
      if (isEdit) {
        if (type === 'deal')    result = await hubspot.updateDeal(record.id, props)
        if (type === 'company') result = await hubspot.updateCompany(record.id, props)
        if (type === 'contact') result = await hubspot.updateContact(record.id, props)

        // Confirmada en múltiples eventos → crear deals adicionales
        if (type === 'deal' && props.bp_estado_prospeccion === 'confirmada') {
          const extras = dealEventos.filter(v => v !== currentDealEvento)
          for (const ev of extras) {
            const evLabel = EVENTOS_PROGRAMADOS.find(e => e.value === ev)?.label || ev
            const newDealProps = {
              dealname: record.properties.dealname,
              bp_evento_codigo: ev,
              bp_estado_prospeccion: 'confirmada',
              hubspot_owner_id: record.properties.hubspot_owner_id || '',
              bp_zona: record.properties.bp_zona || '',
            }
            if (companyIdForEdit) newDealProps._companyId = companyIdForEdit
            await hubspot.createDeal(newDealProps)
            addToast(`Deal creado para ${evLabel}`, 'success')
          }
        }

        addToast(`${TITLES[type]} actualizado`, 'success')
      } else {
        if (type === 'deal')    result = await hubspot.createDeal(props)
        if (type === 'company') result = await hubspot.createCompany(props)
        if (type === 'contact') result = await hubspot.createContact(props)
        addToast(`${TITLES[type]} creado · puede tardar ~1 min en aparecer en búsquedas`, 'success')
        // El backend crea la asociación a la empresa en el mismo request
        // (deal→empresa, contacto→empresa) pero de forma best-effort: si esa
        // asociación falla, el registro igual queda creado y antes esto se
        // perdía en silencio (el toast de éxito no lo mencionaba). Avisamos
        // para que quien lo creó sepa que debe asociarlo manualmente.
        if (result?._assocError) {
          const errMsg = typeof result._assocError === 'string' ? result._assocError : (result._assocError?.message || JSON.stringify(result._assocError))
          addToast(`${TITLES[type]} creado, pero no se pudo asociar a la empresa: ${errMsg}. Ábrelo y asígnalo manualmente.`, 'error')
        }
      }
      onSaved?.(result)
      onClose()
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Error al guardar'
      addToast(typeof msg === 'string' ? msg : JSON.stringify(msg), 'error')
    } finally {
      setSaving(false)
    }
  }

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16
    }}>
      <div style={{
        background: '#fff', borderRadius: 10, width: '100%', maxWidth: 560,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,.2)'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>
            {isEdit ? `Editar ${TITLES[type]}` : `Nuevo ${TITLES[type]}`}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b778c', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Selector de evento para Confirmada / No participa (solo edición de deals) */}
          {type === 'deal' && isEdit && form.bp_estado_prospeccion === 'confirmada' && (
            <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 8 }}>
                ✅ ¿En qué evento(s) confirma participación?
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {EVENTOS_PROGRAMADOS.map(ev => (
                  <label key={ev.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={dealEventos.includes(ev.value)}
                      onChange={() => toggleDealEvento(ev.value)}
                      style={{ accentColor: '#15803d', width: 15, height: 15 }}
                    />
                    <span style={{ color: '#374151' }}>{ev.label}</span>
                    {ev.value === currentDealEvento && (
                      <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 10 }}>actual</span>
                    )}
                  </label>
                ))}
              </div>
              {dealEventos.filter(v => v !== currentDealEvento).length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#166534', background: '#dcfce7', borderRadius: 5, padding: '5px 8px' }}>
                  Se crearán deals adicionales para: {dealEventos.filter(v => v !== currentDealEvento).map(v => EVENTOS_PROGRAMADOS.find(e => e.value === v)?.label).join(', ')}
                </div>
              )}
            </div>
          )}

          {type === 'deal' && isEdit && form.bp_estado_prospeccion === 'no_participa' && (
            <div style={{ marginBottom: 16, padding: '12px 14px', background: '#fef9ec', border: '1px solid #fcd34d', borderRadius: 8 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
                🔄 ¿Le interesa participar en otro evento programado?
              </label>
              <select
                value={dealEvento}
                onChange={e => setDealEvento(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff' }}
              >
                <option value="">— Sin interés en otros eventos —</option>
                {EVENTOS_PROGRAMADOS.filter(e => e.value !== currentDealEvento).map(e => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
              {dealEvento && dealEvento !== currentDealEvento && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#92400e' }}>
                  El lead se moverá a <strong>{EVENTOS_PROGRAMADOS.find(e => e.value === dealEvento)?.label}</strong> con estado "En seguimiento".
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {fields.map(f => (
              <div key={f.key} style={{ gridColumn: (f.type === 'textarea' || f.type === 'company-search' || f.type === 'company-name-search' || f.type === 'checkbox') ? '1 / -1' : 'auto' }}>
                {f.type !== 'checkbox' && (
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b778c', marginBottom: 5 }}>
                    {f.label}{f.required && <span style={{ color: '#de350b' }}> *</span>}
                  </label>
                )}
                {f.type === 'checkbox' ? (
                  <div style={{
                    padding: '10px 12px',
                    background: form[f.key] ? (f.activeBg || '#fff1f0') : '#f7f8fa',
                    border: `1px solid ${form[f.key] ? (f.activeBorder || '#ffa39e') : '#dfe1e6'}`,
                    borderRadius: 6,
                  }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={!!form[f.key]}
                        onChange={e => set(f.key, e.target.checked)}
                        style={{ marginTop: 2, accentColor: f.activeColor || '#de350b', width: 15, height: 15, flexShrink: 0 }}
                      />
                      <span>
                        <span style={{ fontWeight: 600, color: form[f.key] ? (f.activeColor || '#172b4d') : '#172b4d' }}>
                          {f.icon ? `${f.icon} ` : ''}{f.label}
                        </span>
                        {f.helpText && <div style={{ fontSize: 11, color: '#6b778c', marginTop: 2 }}>{f.helpText}</div>}
                      </span>
                    </label>
                  </div>
                ) : f.type === 'company-search' ? (
                  <>
                    <CompanySearchField
                      value={form[f.key] || ''}
                      onChange={(v) => { set(f.key, v); setErrors(prev => ({ ...prev, company: undefined })) }}
                      onCompanySelect={(id) => { setSelectedCompanyId(id); setErrors(prev => ({ ...prev, company: undefined })) }}
                    />
                    {errors[f.key] && (
                      <div style={{ marginTop: 6, padding: '8px 12px', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, fontSize: 12, color: '#856404' }}>
                        ⚠️ {errors[f.key]}
                      </div>
                    )}
                  </>
                ) : f.type === 'company-name-search' ? (
                  <CompanySearchField
                    value={form[f.key] || ''}
                    onChange={(v) => set(f.key, v)}
                    onCompanySelect={() => {}}
                  />
                ) : f.type === 'country-autocomplete' ? (
                  <AutocompleteField
                    value={form[f.key] || ''}
                    onChange={(v) => set(f.key, v)}
                    options={COUNTRY_LABELS}
                    placeholder="Selecciona o escribe un país…"
                    hasError={errors[f.key]}
                  />
                ) : f.type === 'city-autocomplete' ? (
                  <CityAutocompleteField
                    value={form[f.key] || ''}
                    onChange={(v) => set(f.key, v)}
                    countryLabel={form.country || ''}
                    placeholder="Selecciona o escribe una ciudad…"
                    hasError={errors[f.key]}
                  />
                ) : f.type === 'select' ? (
                  <>
                    <select
                      value={form[f.key] || ''}
                      onChange={e => set(f.key, e.target.value)}
                      style={inputStyle(errors[f.key])}
                    >
                      <option value="">— Seleccionar —</option>
                      {f.options.map(o => (
                        <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
                      ))}
                    </select>
                    {f.helpText && <div style={{ fontSize: 11, color: '#6b778c', marginTop: 4 }}>{f.helpText}</div>}
                  </>
                ) : f.type === 'textarea' ? (
                  <textarea
                    value={form[f.key] || ''}
                    onChange={e => set(f.key, e.target.value)}
                    rows={3}
                    style={{ ...inputStyle(errors[f.key]), resize: 'vertical' }}
                    placeholder={f.placeholder || ''}
                  />
                ) : (
                  <input
                    type={f.type || 'text'}
                    value={form[f.key] || ''}
                    onChange={e => set(f.key, e.target.value)}
                    style={inputStyle(errors[f.key])}
                    placeholder={f.placeholder || ''}
                  />
                )}
                {errors[f.key] && (
                  <div style={{ fontSize: 11, color: '#de350b', marginTop: 3 }}>{errors[f.key]}</div>
                )}
              </div>
            ))}
          </div>
        </form>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid #e2e8f0', flexShrink: 0,
          display: 'flex', justifyContent: 'flex-end', gap: 10
        }}>
          <button onClick={onClose} className="btn btn-ghost" disabled={saving}>Cancelar</button>
          <button onClick={handleSubmit} className="btn btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Botón de eliminar ──────────────────────────────────────────────────────────
export function DeleteButton({ type, id, name, onDeleted }) {
  const { addToast } = useToast()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const TITLES = { deal: 'evento', company: 'empresa', contact: 'contacto' }

  const refreshAfterDelete = async () => {
    const listKey = type === 'deal' ? 'deals' : type === 'company' ? 'companies' : 'contacts'
    const detailKey = type === 'deal' ? 'deal' : type === 'company' ? 'company' : 'contact'

    qc.removeQueries([detailKey, id], { exact: true })
    qc.removeQueries(listKey)
    qc.removeQueries(['pipeline-deals'])

    invalidateDashboard(qc)
    await Promise.all([
      qc.invalidateQueries(listKey),
      qc.invalidateQueries('reports-bp-summary'),
      qc.invalidateQueries(['pipeline-deals']),
    ])
  }

  const doDelete = async () => {
    setDeleting(true)
    try {
      if (type === 'deal')    await hubspot.deleteDeal(id)
      if (type === 'company') await hubspot.deleteCompany(id)
      if (type === 'contact') await hubspot.deleteContact(id)
      await refreshAfterDelete()
      addToast(`${TITLES[type]} eliminado`, 'success')
      onDeleted?.()
    } catch (err) {
      addToast(err.response?.data?.error || 'Error al eliminar', 'error')
      setConfirm(false)
      setDeleting(false)
    }
  }

  if (!confirm) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        style={{ color: '#de350b', borderColor: '#de350b' }}
        onClick={() => setConfirm(true)}
      >
        🗑 Eliminar
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#ffebe6', padding: '6px 10px', borderRadius: 6, border: '1px solid #ffbdad' }}>
      <span style={{ fontSize: 12, color: '#bf2600' }}>¿Eliminar <strong>{name}</strong>?</span>
      <button
        className="btn btn-sm"
        style={{ background: '#de350b', color: '#fff', padding: '4px 10px', fontSize: 12 }}
        onClick={doDelete} disabled={deleting}
      >
        {deleting ? '…' : 'Sí, eliminar'}
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setConfirm(false)}
        disabled={deleting}
      >
        Cancelar
      </button>
    </div>
  )
}

const inputStyle = (hasError) => ({
  width: '100%', padding: '7px 10px', border: `1px solid ${hasError ? '#de350b' : '#dfe1e6'}`,
  borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit',
  background: '#fff', color: '#172b4d', boxSizing: 'border-box'
})
