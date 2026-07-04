// Propiedades y constantes BePharma para HubSpot.
// Centralizar aqui evita que las reglas de negocio queden dispersas en rutas.

const ACTIVE_EVENT = process.env.BP_EVENTO_ACTIVO || 'BEPH-2026-09'

// Propiedades default que se piden al buscar deals/eventos
const DEAL_PROPERTIES = [
  'dealname',
  'dealstage',
  'createdate',
  'hubspot_owner_id',
  'bp_evento_codigo',
  'bp_zona',
  'bp_evento_paises',
  'bp_estado_prospeccion',
  'bp_estado_alerta',
  'bp_proximo_contacto',
  'bp_ultima_actividad_operador',
  'bp_decision_participacion',
  'hs_num_associated_contacts',
]

const DEAL_DETAIL_PROPERTIES = [
  ...DEAL_PROPERTIES,
  'description',
  'hs_next_step',
  'hs_lastmodifieddate',
]

const COMPANY_PROPERTIES = [
  'name',
  'domain',
  'industry',
  'city',
  'country',
  'phone',
  'createdate',
  'numberofemployees',
  'annualrevenue',
  'lifecyclestage',
  'hubspot_owner_id',
  'bp_etapa_empresa',
  'bp_email_empresa',
  'bp_pais_principal',
  'bp_telefonos_adicionales',
  'bp_whatsapp_empresa',
  'bp_contacto_principal_texto',
  'bp_cargo_contacto_principal',
  'bp_email_contacto_principal',
  'bp_telefono_contacto_principal',
  'bp_zona',
  'description',
  'num_associated_contacts',
  'num_associated_deals',
  'bp_lista_negra',
  'bp_participo_eventos',
  'bp_estado_aprobacion',
]

// Definición única de los 5 indicadores de "calidad de datos" de Empresas
// (usado por /api/hubspot/companies/quality-metrics para las gráficas y por
// /api/hubspot/companies/search vía ?qualityFilter= para filtrar el listado
// al hacer clic en una barra — ambos leen de aquí para no duplicar criterio).
// orFilters con más de un elemento = condiciones unidas por OR entre sí
// (ej. "sin contacto" = no tiene la propiedad O la tiene en 0).
const COMPANY_QUALITY_FILTERS = {
  sinContacto: {
    label: 'Sin contacto',
    orFilters: [
      { propertyName: 'num_associated_contacts', operator: 'NOT_HAS_PROPERTY' },
      { propertyName: 'num_associated_contacts', operator: 'EQ', value: '0' },
    ],
  },
  sinTelefono: {
    label: 'Sin teléfono',
    orFilters: [{ propertyName: 'phone', operator: 'NOT_HAS_PROPERTY' }],
  },
  sinPaginaWeb: {
    label: 'Sin página web',
    orFilters: [{ propertyName: 'domain', operator: 'NOT_HAS_PROPERTY' }],
  },
  sinCorreo: {
    label: 'Sin correo',
    orFilters: [{ propertyName: 'bp_email_empresa', operator: 'NOT_HAS_PROPERTY' }],
  },
  sinEventos: {
    label: 'Sin eventos',
    orFilters: [
      { propertyName: 'num_associated_deals', operator: 'NOT_HAS_PROPERTY' },
      { propertyName: 'num_associated_deals', operator: 'EQ', value: '0' },
    ],
  },
}

const CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'phone',
  'jobtitle',
  'company',
  'country',
  'createdate',
  'hubspot_owner_id',
  'hs_linkedin_url',
  'bp_rol_en_empresa',
  'bp_estado_relacion_empresa',
  'bp_fecha_verificacion_empresa',
  'bp_rotacion_detectada',
  'bp_empresa_anterior_texto',
  'bp_empresa_actual_texto',
  'bp_fecha_cambio_empresa',
  'bp_notas_movilidad_contacto',
  'bp_notas_contacto',
]

// Definición única de los 5 indicadores de "calidad de datos" de Contactos
// (mismo patrón que COMPANY_QUALITY_FILTERS — usado por
// /api/hubspot/contacts/quality-metrics y por ?qualityFilter= en /search).
const CONTACT_QUALITY_FILTERS = {
  sinCorreo:   { label: 'Sin correo',    orFilters: [{ propertyName: 'email', operator: 'NOT_HAS_PROPERTY' }] },
  sinTelefono: { label: 'Sin teléfono',  orFilters: [{ propertyName: 'phone', operator: 'NOT_HAS_PROPERTY' }] },
  sinCargo:    { label: 'Sin cargo',     orFilters: [{ propertyName: 'jobtitle', operator: 'NOT_HAS_PROPERTY' }] },
  sinEmpresa:  { label: 'Sin empresa',   orFilters: [{ propertyName: 'company', operator: 'NOT_HAS_PROPERTY' }] },
  sinLinkedin: { label: 'Sin LinkedIn',  orFilters: [{ propertyName: 'hs_linkedin_url', operator: 'NOT_HAS_PROPERTY' }] },
}

// Etapas del pipeline BePharma - Eventos
// Claves: valores internos de HubSpot dealstage
// Si los IDs reales difieren, actualizar aqui y el resto de la app usa los labels
// NOTA: el value interno de HubSpot sigue siendo 'contacto_enviado' — solo el
// label visible cambió a "Por Contactar" (redefinición de negocio 02-jul-2026).
const PIPELINE_STAGES = [
  { key: 'nueva',              label: 'Nueva' },
  { key: 'en_depuracion',      label: 'En Depuración' },
  { key: 'en_enriquecimiento', label: 'En Enriquecimiento' },
  { key: 'contacto_enviado',   label: 'Por Contactar' },
  { key: 'en_seguimiento',     label: 'En Seguimiento' },
  { key: 'confirmada',         label: 'Confirmada' },
  { key: 'no_participa',       label: 'No Participa' },
]

// Etapas terminales: no cuentan como activas en metricas
const TERMINAL_STAGES = ['confirmada', 'no_participa']

// Etapas que el CRM asigna automáticamente según cantidad de datos de contacto
// disponibles (empresa + contactos asociados) — ver api/services/autoStage.service.js.
// Las etapas restantes (en_seguimiento, confirmada, no_participa) son decisión
// exclusiva del operador y el recálculo automático NUNCA las sobreescribe.
const AUTO_STAGE_KEYS = ['nueva', 'en_depuracion', 'en_enriquecimiento', 'contacto_enviado']

// Filtro base para el evento activo - se aplica a todas las queries de deals
function activeEventFilter() {
  return { propertyName: 'bp_evento_codigo', operator: 'EQ', value: ACTIVE_EVENT }
}

// Filtro para excluir etapas terminales
function notTerminalFilters() {
  return TERMINAL_STAGES.map(stage => ({
    propertyName: 'bp_estado_prospeccion',
    operator: 'NEQ',
    value: stage,
  }))
}

module.exports = {
  ACTIVE_EVENT,
  DEAL_PROPERTIES,
  DEAL_DETAIL_PROPERTIES,
  COMPANY_PROPERTIES,
  CONTACT_PROPERTIES,
  PIPELINE_STAGES,
  TERMINAL_STAGES,
  AUTO_STAGE_KEYS,
  COMPANY_QUALITY_FILTERS,
  CONTACT_QUALITY_FILTERS,
  activeEventFilter,
  notTerminalFilters,
}
