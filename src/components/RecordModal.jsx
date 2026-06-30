import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from 'react-query'
import { X, Search } from 'lucide-react'
import { hubspot } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'

// ── Países (label español, en para API de ciudades) ────────────────────────────
const COUNTRIES = [
  { label: 'Argentina', en: 'Argentina' },
  { label: 'Australia', en: 'Australia' },
  { label: 'Austria', en: 'Austria' },
  { label: 'Bélgica', en: 'Belgium' },
  { label: 'Bolivia', en: 'Bolivia' },
  { label: 'Brasil', en: 'Brazil' },
  { label: 'Canadá', en: 'Canada' },
  { label: 'Chile', en: 'Chile' },
  { label: 'China', en: 'China' },
  { label: 'Colombia', en: 'Colombia' },
  { label: 'Costa Rica', en: 'Costa Rica' },
  { label: 'Cuba', en: 'Cuba' },
  { label: 'Dinamarca', en: 'Denmark' },
  { label: 'Ecuador', en: 'Ecuador' },
  { label: 'Egipto', en: 'Egypt' },
  { label: 'El Salvador', en: 'El Salvador' },
  { label: 'Emiratos Árabes Unidos', en: 'United Arab Emirates' },
  { label: 'España', en: 'Spain' },
  { label: 'Estados Unidos', en: 'United States' },
  { label: 'Etiopía', en: 'Ethiopia' },
  { label: 'Filipinas', en: 'Philippines' },
  { label: 'Finlandia', en: 'Finland' },
  { label: 'Francia', en: 'France' },
  { label: 'Ghana', en: 'Ghana' },
  { label: 'Guatemala', en: 'Guatemala' },
  { label: 'Honduras', en: 'Honduras' },
  { label: 'India', en: 'India' },
  { label: 'Indonesia', en: 'Indonesia' },
  { label: 'Irán', en: 'Iran' },
  { label: 'Iraq', en: 'Iraq' },
  { label: 'Irlanda', en: 'Ireland' },
  { label: 'Israel', en: 'Israel' },
  { label: 'Italia', en: 'Italy' },
  { label: 'Japón', en: 'Japan' },
  { label: 'Jordania', en: 'Jordan' },
  { label: 'Kazajistán', en: 'Kazakhstan' },
  { label: 'Kenia', en: 'Kenya' },
  { label: 'Marruecos', en: 'Morocco' },
  { label: 'México', en: 'Mexico' },
  { label: 'Nigeria', en: 'Nigeria' },
  { label: 'Noruega', en: 'Norway' },
  { label: 'Nueva Zelanda', en: 'New Zealand' },
  { label: 'Países Bajos', en: 'Netherlands' },
  { label: 'Pakistán', en: 'Pakistan' },
  { label: 'Panamá', en: 'Panama' },
  { label: 'Paraguay', en: 'Paraguay' },
  { label: 'Perú', en: 'Peru' },
  { label: 'Polonia', en: 'Poland' },
  { label: 'Portugal', en: 'Portugal' },
  { label: 'Puerto Rico', en: 'Puerto Rico' },
  { label: 'Reino Unido', en: 'United Kingdom' },
  { label: 'República Checa', en: 'Czech Republic' },
  { label: 'República Dominicana', en: 'Dominican Republic' },
  { label: 'Rumanía', en: 'Romania' },
  { label: 'Rusia', en: 'Russia' },
  { label: 'Arabia Saudita', en: 'Saudi Arabia' },
  { label: 'Sudáfrica', en: 'South Africa' },
  { label: 'Suecia', en: 'Sweden' },
  { label: 'Suiza', en: 'Switzerland' },
  { label: 'Tailandia', en: 'Thailand' },
  { label: 'Taiwán', en: 'Taiwan' },
  { label: 'Turquía', en: 'Turkey' },
  { label: 'Ucrania', en: 'Ukraine' },
  { label: 'Uruguay', en: 'Uruguay' },
  { label: 'Venezuela', en: 'Venezuela' },
  { label: 'Vietnam', en: 'Vietnam' },
]
const COUNTRY_LABELS = COUNTRIES.map(c => c.label)
const COUNTRY_EN_BY_LABEL = Object.fromEntries(COUNTRIES.map(c => [c.label, c.en]))

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
      { value: 'contacto_enviado',   label: 'Contacto enviado' },
      { value: 'en_seguimiento',     label: 'En seguimiento' },
      { value: 'confirmada',         label: 'Confirmada BePharma' },
      { value: 'no_participa',       label: 'No participa' },
    ]
  },
  { key: 'hs_next_step', label: 'Siguiente paso', type: 'textarea' },
  { key: 'description',  label: 'Descripción',    type: 'textarea' },
]

const COMPANY_FIELDS = [
  { key: 'name',     label: 'Nombre de la empresa', required: true, type: 'company-name-search' },
  { key: 'domain',   label: 'Dominio web',           type: 'text', placeholder: 'empresa.com' },
  { key: 'phone',    label: 'Teléfono',              type: 'text' },
  { key: 'country',  label: 'País',                  type: 'country-autocomplete' },
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
]

const CONTACT_FIELDS = [
  { key: 'firstname', label: 'Nombre',    required: true, type: 'text' },
  { key: 'lastname',  label: 'Apellido',  type: 'text' },
  { key: 'email',     label: 'Email',     type: 'email' },
  { key: 'phone',     label: 'Teléfono',  type: 'text' },
  { key: 'jobtitle',  label: 'Cargo',     type: 'text' },
  { key: 'company',   label: 'Empresa',   type: 'company-search' },
  { key: 'hs_linkedin_url', label: 'LinkedIn URL', type: 'text', placeholder: 'https://linkedin.com/in/...' },
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
  { value: 'nueva',              label: 'Nueva' },
  { value: 'en_depuracion',      label: 'En Depuración' },
  { value: 'en_enriquecimiento', label: 'En Enriquecimiento' },
  { value: 'contacto_enviado',   label: 'Contacto enviado' },
  { value: 'en_seguimiento',     label: 'En seguimiento' },
  { value: 'confirmada',         label: 'Confirmada BePharma' },
  { value: 'no_participa',       label: 'No participa' },
]

// Campos para crear deal desde empresa (solo estado prospección)
const DEAL_FIELDS_FROM_COMPANY = [
  { key: 'dealname', label: 'Nombre del evento', required: true, type: 'text' },
  { key: 'bp_estado_prospeccion', label: 'Estado de prospección', required: true, type: 'select',
    options: DEAL_PROSPECCION_OPTIONS
  },
]

// Campos para editar deal (sin nombre ni zona — ambos son automáticos)
const DEAL_FIELDS_EDIT = [
  { key: 'bp_estado_prospeccion', label: 'Estado de prospección', required: true, type: 'select',
    options: DEAL_PROSPECCION_OPTIONS
  },
  { key: 'hs_next_step', label: 'Siguiente paso', type: 'textarea' },
]

// ── Modal ──────────────────────────────────────────────────────────────────────
export default function RecordModal({ type, record, onClose, onSaved, companyId = null, defaults = {} }) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const isEdit = !!record?.id

  // Selección de campos según contexto
  const fields = (() => {
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
    initial[f.key] = val
  })

  const [form, setForm]             = useState(initial)
  const [saving, setSaving]         = useState(false)
  const [errors, setErrors]         = useState({})
  const [selectedCompanyId, setSelectedCompanyId] = useState(null)

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
        props[f.key] = f.type === 'number' ? String(val) : val
      }
    })
    // Para contactos: incluir company name, _companyId y asignar owner al usuario actual
    if (type === 'contact') {
      if (form.company) props.company = form.company
      if (selectedCompanyId) props._companyId = selectedCompanyId
      if (!isEdit && user?.ownerId) props.hubspot_owner_id = String(user.ownerId)
    }
    if (type === 'deal') {
      // Auto-asignar zona del usuario en cualquier operación de deal
      if (!props.bp_zona && user?.bp_zona) props.bp_zona = user.bp_zona
      if (!isEdit) {
        if (companyId) props._companyId = companyId
        // Incluir defaults ocultos (ej: bp_evento_codigo)
        Object.entries(defaults).forEach(([k, v]) => {
          if (!(k in props) && v) props[k] = v
        })
      }
    }

    try {
      let result
      if (isEdit) {
        if (type === 'deal')    result = await hubspot.updateDeal(record.id, props)
        if (type === 'company') result = await hubspot.updateCompany(record.id, props)
        if (type === 'contact') result = await hubspot.updateContact(record.id, props)
        addToast(`${TITLES[type]} actualizado`, 'success')
      } else {
        if (type === 'deal')    result = await hubspot.createDeal(props)
        if (type === 'company') result = await hubspot.createCompany(props)
        if (type === 'contact') result = await hubspot.createContact(props)
        addToast(`${TITLES[type]} creado · puede tardar ~1 min en aparecer en búsquedas`, 'success')
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {fields.map(f => (
              <div key={f.key} style={{ gridColumn: (f.type === 'textarea' || f.type === 'company-search' || f.type === 'company-name-search') ? '1 / -1' : 'auto' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b778c', marginBottom: 5 }}>
                  {f.label}{f.required && <span style={{ color: '#de350b' }}> *</span>}
                </label>
                {f.type === 'company-search' ? (
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
                  <select
                    value={form[f.key] || ''}
                    onChange={e => set(f.key, e.target.value)}
                    style={inputStyle(errors[f.key])}
                  >
                    <option value="">— Seleccionar —</option>
                    {f.options.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
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

    await Promise.all([
      qc.invalidateQueries(listKey),
      qc.invalidateQueries('metrics'),
      qc.invalidateQueries('charts'),
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
