import React, { useState } from 'react'
import {
  HelpCircle, LayoutDashboard, Briefcase, Building2, Kanban, Users, Search,
  Phone, BarChart2, Settings, Info, Ban, Mail as MailIcon, MessageCircle,
} from 'lucide-react'
import Topbar from '../components/Topbar'
import { useAuth } from '../contexts/AuthContext'

// ---------------------------------------------------------------------------
// Módulo de Ayuda / Autoaprendizaje — guía de uso del CRM, adaptada al rol
// del usuario que la ve (operador vs. supervisor). Contenido 100% estático,
// no llama a la API — es documentación embebida en el propio CRM.
// ---------------------------------------------------------------------------

const STAGES = [
  { label: 'Nueva',              color: '#2563eb', bg: '#eff6ff', desc: 'El evento se creó (deal nuevo) pero todavía no se revisó ningún dato de la empresa.' },
  { label: 'En Depuración',      color: '#d97706', bg: '#fffbeb', desc: 'Se está limpiando/verificando la información de la empresa antes de buscar contactos.' },
  { label: 'En Enriquecimiento', color: '#7c3aed', bg: '#f5f3ff', desc: 'Se están buscando datos de contacto (teléfono, email, LinkedIn) con Apollo/RocketReach.' },
  { label: 'Por Contactar',      color: '#0369a1', bg: '#f0f9ff', desc: 'Ya hay datos de contacto suficientes; falta hacer el primer contacto (llamada/email/LinkedIn).' },
  { label: 'En Seguimiento',     color: '#0f766e', bg: '#f0fdfa', desc: 'Ya se contactó a la empresa y se está dando seguimiento a la conversación.' },
  { label: 'Confirmada',         color: '#15803d', bg: '#f0fdf4', desc: 'La empresa confirmó su participación en el evento BePharma.' },
  { label: 'No Participa',       color: '#b91c1c', bg: '#fef2f2', desc: 'La empresa decidió no participar en este evento (se puede reintentar en el siguiente).' },
]

function Tip({ children, tone = 'info' }) {
  const palettes = {
    info:    { bg: '#e3f2fd', color: '#0d47a1' },
    warn:    { bg: '#fff8e1', color: '#8a6914' },
    danger:  { bg: '#ffebe6', color: '#bf2600' },
    success: { bg: '#e3fcef', color: '#006644' },
  }
  const p = palettes[tone]
  return (
    <div style={{ background: p.bg, color: p.color, borderRadius: 6, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.6, marginTop: 10 }}>
      {children}
    </div>
  )
}

function RoleBadge({ role }) {
  const map = {
    operator:   { label: 'Operador',   bg: '#deebff', color: '#0052cc' },
    supervisor: { label: 'Supervisor', bg: '#e3fcef', color: '#006644' },
    both:       { label: 'Operador + Supervisor', bg: '#f4f5f7', color: '#42526e' },
  }
  const m = map[role]
  return (
    <span style={{ background: m.bg, color: m.color, padding: '2px 9px', borderRadius: 12, fontSize: 10.5, fontWeight: 700 }}>
      {m.label}
    </span>
  )
}

function Card({ title, icon: Icon, iconColor, role, children }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {Icon && <Icon size={15} style={{ color: iconColor || '#4fc3f7' }} />} {title}
        </h2>
        {role && <RoleBadge role={role} />}
      </div>
      <div className="card-body" style={{ fontSize: 13, lineHeight: 1.75, color: '#374151' }}>
        {children}
      </div>
    </div>
  )
}

function FieldTable({ rows }) {
  return (
    <div className="table-wrap" style={{ marginTop: 4, marginBottom: 4 }}>
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600, whiteSpace: 'nowrap', width: 200, fontSize: 12.5 }}>{r[0]}</td>
              <td style={{ fontSize: 12.5, color: '#546e7a' }}>{r[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Contenido de cada sección
// ---------------------------------------------------------------------------

function SectionIntro({ isSupervisor }) {
  return (
    <>
      <Card title="Bienvenida" icon={Info}>
        <p>
          BePharma CRM es el sistema con el que el equipo prospecta empresas farmacéuticas para
          invitarlas a participar en los eventos BePharma (por ejemplo <strong>BEPH-2026-09</strong>).
          Toda la información vive en HubSpot; este CRM es la interfaz diaria de trabajo — más simple
          y enfocada que HubSpot nativo — y añade funciones propias como Click-to-Call, redacción de
          email con firma y adjuntos, listas negras y reportes de actividad.
        </p>
        <Tip tone="info">
          <strong>Regla de oro:</strong> cada tarjeta/registro de "Evento" (deal) representa la
          participación de <strong>una empresa en un evento específico</strong>. Si una empresa ya
          participó antes y ahora se prospecta para un nuevo evento, se crea un Evento nuevo — la
          Empresa y sus Contactos no se duplican.
        </Tip>
      </Card>

      <Card title="Estructura de la información" icon={Building2}>
        <p style={{ marginBottom: 10 }}>Tres tipos de registro, siempre conectados entre sí:</p>
        <FieldTable rows={[
          ['Empresa', 'Datos maestros del laboratorio/empresa (nombre, dominio, país, teléfono, industria...).'],
          ['Contacto', 'Persona dentro de esa empresa (nombre, cargo, teléfono, email, LinkedIn).'],
          ['Evento (Deal)', 'La participación de una Empresa en un evento BePharma puntual. Aquí se gestiona todo el ciclo de prospección: estado, alertas, próximo contacto, actividades.'],
        ]} />
        <p style={{ marginTop: 10 }}>Un Evento avanza por 7 etapas a lo largo del ciclo de prospección:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {STAGES.map(s => (
            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.color}33`, borderRadius: 8, padding: '8px 12px', minWidth: 180, flex: '1 1 220px' }}>
              <div style={{ color: s.color, fontWeight: 700, fontSize: 12.5, marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 11.5, color: '#546e7a' }}>{s.desc}</div>
            </div>
          ))}
        </div>
        <Tip tone="warn">
          Las primeras 4 etapas (Nueva → En Depuración → En Enriquecimiento → Por Contactar) las
          asigna el CRM <strong>automáticamente</strong> según cuántos datos de contacto tiene la
          empresa. Las últimas 3 (En Seguimiento, Confirmada, No Participa) las decide siempre la
          persona operadora — el sistema nunca las cambia solo.
        </Tip>
      </Card>

      <Card title="Tu rol en el sistema" icon={Users}>
        <p style={{ marginBottom: 10 }}>
          Estás conectado como <strong>{isSupervisor ? 'Supervisor' : 'Operador'}</strong>. Esta misma
          guía se ajusta a lo que puedes ver y hacer:
        </p>
        <FieldTable rows={[
          ['Operador', 'Ve y trabaja solo los Eventos, Empresas y Contactos de su(s) país(es) asignado(s). Puede editar, redactar email, llamar, crear notas/tareas.'],
          ['Supervisor', 'Ve el equipo completo (todos los países y operadores). Además tiene acceso a Reportes y Administración, y puede eliminar registros o subir/bajar el nivel de Alerta de un Evento.'],
        ]} />
        <Tip tone="info">
          Un supervisor puede simular la vista de operador desde el Dashboard (para ver el sistema
          exactamente como lo ve su equipo), sin perder sus permisos reales.
        </Tip>
      </Card>

      <Card title="Iniciar sesión y seguridad" icon={Info}>
        <FieldTable rows={[
          ['Usuario y contraseña', 'Te los entrega tu supervisor. Puedes ver/ocultar la contraseña con el ícono del ojo.'],
          ['¿Olvidaste tu contraseña?', 'Enlace en la pantalla de inicio de sesión — llega un correo para restablecerla.'],
          ['Cambiar contraseña', 'Ícono de llave 🔑 junto a tu nombre, abajo del todo en el menú lateral.'],
          ['Cerrar sesión', 'Ícono de salida, junto al de la llave.'],
        ]} />
      </Card>
    </>
  )
}

function SectionDashboard({ isSupervisor }) {
  return (
    <>
      <Card title={isSupervisor ? 'Dashboard equipo' : 'Mis pendientes'} icon={LayoutDashboard} role={isSupervisor ? 'supervisor' : 'operator'}>
        <p>Es la primera pantalla que ves al entrar. Resume lo urgente del día en tarjetas:</p>
        <FieldTable rows={[
          ['Sin actividad +72h', 'Eventos sin ninguna nota, llamada o email registrado en los últimos 3 días.'],
          [isSupervisor ? 'Callbacks vencidos' : 'Mis callbacks vencidos', 'Eventos con una fecha de "próximo contacto" ya pasada.'],
          [isSupervisor ? 'Sin próximo contacto' : 'Sin próximo contacto', 'Eventos activos que no tienen agendada ninguna próxima acción.'],
          [isSupervisor ? 'Confirmadas BePharma' : 'Mis confirmadas', 'Total de empresas que ya confirmaron su participación.'],
          ...(isSupervisor ? [['Nuevos este mes', 'Eventos creados en el mes en curso, de todo el equipo.']] : []),
        ]} />
      </Card>

      <Card title="Gráficos del pipeline" icon={BarChart2}>
        <p>Debajo de las tarjetas hay un panel con:</p>
        <FieldTable rows={[
          ['Filtros', isSupervisor ? 'Alerta, Operador y País — se pueden combinar.' : 'Alerta y País.'],
          ['Barras por etapa', 'Cuántos eventos hay en cada una de las 7 etapas.'],
          ['Dona de distribución', 'Lo mismo en formato circular, con el total en el centro.'],
          ['Nuevos eventos · últimos 6 meses', 'Tendencia mensual de eventos creados.'],
          ['Checkboxes de etapa', 'Debajo de las barras — al marcarlos, filtran la tabla de alertas de abajo.'],
        ]} />
        <Tip tone="info">Haz clic sobre cualquier barra, porción de dona o número para filtrar automáticamente.</Tip>
      </Card>

      <Card title={isSupervisor ? 'Eventos con alerta activa' : 'Alertas del supervisor'} icon={Info}>
        <p>
          Tabla con los Eventos que tienen una alerta amarilla o roja levantada (ver sección
          "Preguntas frecuentes" para el significado de cada color). Haz clic en cualquier fila para
          abrir esa ficha directamente.
        </p>
      </Card>

      {isSupervisor && (
        <Card title="Accesos rápidos y Equipo" icon={Users} role="supervisor">
          <FieldTable rows={[
            ['Accesos rápidos', 'Atajos a "Todos los eventos activos", "Confirmadas BePharma" y "Pipeline de Eventos".'],
            ['Equipo', 'Lista de operadores con los países que tiene asignado cada uno — clic en "Ver reportes" para ir al módulo de Reportes.'],
          ]} />
        </Card>
      )}

      <Card title="Exportar a Excel" icon={Info}>
        <p>El botón "Exportar a Excel" (arriba a la derecha) descarga la vista actual con los filtros que tengas aplicados.</p>
      </Card>
    </>
  )
}

function SectionEventos({ isSupervisor }) {
  return (
    <>
      <Card title={isSupervisor ? 'Todos los eventos' : 'Mis eventos'} icon={Briefcase}>
        <p>Lista completa de Eventos (deals) con buscador y filtros:</p>
        <FieldTable rows={[
          ['Buscar evento…', 'Busca por nombre de empresa o de evento.'],
          ['Estado', 'Filtra por cualquiera de las 7 etapas del pipeline.'],
          ['Alertas', 'Sin alerta / Alerta amarilla / Alerta roja.'],
          ...(isSupervisor ? [['Operador', 'Filtra por operador específico (solo supervisor).']] : []),
          ['País', 'Filtra por país de la empresa.'],
        ]} />
        <p style={{ marginTop: 8 }}>
          Columnas: Evento, {isSupervisor ? 'Owner (operador dueño), ' : ''}Zona, País, Estado, Próximo
          contacto, Última actividad y Alerta. Haz clic en cualquier fila para abrir la ficha completa.
        </p>
      </Card>

      <Card title="Ficha de un Evento" icon={Briefcase}>
        <p style={{ marginBottom: 8 }}>Al abrir un Evento encontrarás:</p>
        <FieldTable rows={[
          ['Pestaña Información', 'Fecha de creación, propietario, estado, siguiente paso, la Empresa vinculada y sus Contactos (⭐ marca el contacto predeterminado para email).'],
          ['Pestaña Actividades', 'Historial cronológico de notas, llamadas, LinkedIn, emails y tareas registradas en este evento.'],
          ['Botón Email', 'Abre el redactor de correo (ver sección "Comunicación").'],
          ['Botón Editar', 'Cambia estado, siguiente paso y otros campos del evento.'],
          ['Botón Tarea', 'Crea una tarea con fecha límite para dar seguimiento.'],
          ...(isSupervisor ? [
            ['Botón Alerta (solo supervisor)', 'Sube/baja el nivel de alerta manualmente: sin alerta → amarilla → roja → sin alerta.'],
            ['Botón Eliminar (solo supervisor)', 'Elimina el evento. Úsalo con cuidado — no se puede deshacer desde el CRM.'],
          ] : []),
          ['Barra inferior (Nota / LinkedIn)', 'Agrega una nota rápida o registra una gestión de LinkedIn sin salir de la pantalla.'],
          ['Panel Click-to-Call', 'A la derecha — llama directamente al teléfono del contacto activo (ver "Comunicación").'],
        ]} />
        {!isSupervisor && (
          <Tip tone="info">
            Como operador no verás los botones <strong>Alerta</strong> ni <strong>Eliminar</strong> —
            esas dos acciones son exclusivas de supervisores.
          </Tip>
        )}
      </Card>
    </>
  )
}

function SectionEmpresas() {
  return (
    <>
      <Card title="Empresas" icon={Building2}>
        <p>Lista de todas las empresas de tu zona (o de todo el equipo, si eres supervisor):</p>
        <FieldTable rows={[
          ['Buscar empresa…', 'Por nombre.'],
          ['País', 'Filtra por país.'],
          ['Con o sin contactos', 'Muestra solo empresas que sí/no tienen contactos cargados.'],
          ['Ocultar lista negra', 'Activado por defecto — oculta empresas marcadas como lista negra.'],
          ['Gráfico "Calidad de datos"', 'Barras clicables: sin contacto, sin teléfono, sin página web, sin correo, sin eventos. Sirven como filtro rápido (se pueden combinar).'],
          ['+ Nueva empresa', 'Abre el formulario de alta manual.'],
          ['Exportar a Excel', 'Descarga la lista con los filtros aplicados.'],
        ]} />
      </Card>

      <Card title="Crear una empresa nueva" icon={Building2}>
        <FieldTable rows={[
          ['Nombre de la empresa *', 'Obligatorio — busca primero por si ya existe, para no duplicar.'],
          ['País *', 'Obligatorio al crear (determina qué operador la puede ver).'],
          ['Dominio web / Teléfono / Ciudad / Industria / Nº empleados / Descripción', 'Opcionales.'],
          ['Participó en Eventos', 'Marca manual — indica que la empresa ya participó en algún evento BePharma histórico o confirmado.'],
          ['Lista negra', 'No contactar a esta empresa en futuros eventos. La empresa sigue en la base de datos, solo se marca visualmente para excluirla al armar listas de prospección — no bloquea nada automáticamente.'],
        ]} />
      </Card>

      <Card title="Ficha de una Empresa" icon={Building2}>
        <FieldTable rows={[
          ['Banner "Participó antes"', 'Aparece si la empresa ya estuvo en algún evento anterior.'],
          ['Badges de calidad', 'Ej. "Sin correo", "Sin eventos" — mismos criterios del gráfico de calidad de datos.'],
          ['Datos generales', 'Dominio, teléfono, ciudad, país, industria, nº empleados, ingresos anuales, lifecycle stage, descripción.'],
          ['Contactos', 'Lista de personas asociadas a esta empresa.'],
          ['Historial de eventos', 'Todos los Eventos (deals) en los que ha participado esta empresa a lo largo del tiempo. Botón "Crear evento" para prospectarla en un evento nuevo.'],
        ]} />
        <Tip tone="danger">
          <Ban size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
          Por diseño, <strong>no se puede enviar email ni llamar desde la ficha de Empresa</strong> —
          esas acciones viven únicamente en la ficha del Evento, para mantener toda la comunicación
          trazada a un evento concreto.
        </Tip>
      </Card>
    </>
  )
}

function SectionKanban({ isSupervisor }) {
  return (
    <Card title="Pipeline de Eventos (vista Kanban)" icon={Kanban}>
      <p>Vista visual del pipeline completo, organizada en columnas por etapa (las mismas 7 de siempre).</p>
      <FieldTable rows={[
        ['Arrastrar y soltar', 'Arrastra una tarjeta a otra columna para cambiar su etapa al instante.'],
        ['Buscar empresa…', 'Filtra las tarjetas visibles por nombre de empresa.'],
        ...(isSupervisor ? [['Todos los operadores', 'Filtra el tablero por operador específico.']] : []),
        ['Confirmada / No Participa', 'Estas dos columnas aparecen colapsadas a la derecha (solo un contador) para no saturar la vista — haz clic en la flecha para expandirlas.'],
      ]} />
      <Tip tone="warn">
        Si un evento (BEPH-2026-09, por ejemplo) tiene más de 500 registros, el Kanban solo muestra
        las 500 tarjetas más recientes por límite de rendimiento. Para ver o filtrar el listado
        completo, usa la vista de lista en "{isSupervisor ? 'Todos los eventos' : 'Mis eventos'}".
      </Tip>
    </Card>
  )
}

function SectionContactos() {
  return (
    <>
      <Card title="Contactos" icon={Users}>
        <p>Lista de todas las personas de contacto de tu zona, con el mismo patrón de calidad de datos que Empresas (sin correo, sin teléfono, sin cargo, sin empresa, sin LinkedIn).</p>
        <FieldTable rows={[
          ['Buscar…', 'Por nombre, apellido, teléfono o empresa.'],
          ['País', 'Filtra por país.'],
          ['+ Nuevo contacto', 'Alta manual — puedes vincularlo a una empresa existente.'],
        ]} />
      </Card>
      <Card title="Ficha de un Contacto" icon={Users}>
        <FieldTable rows={[
          ['Datos generales', 'Email, teléfono, cargo, empresa vinculada, notas.'],
          ['Empresa vinculada', 'Accede directo a la ficha de la empresa a la que pertenece.'],
          ['Buscar en LinkedIn', 'Botón directo a la búsqueda del contacto en LinkedIn.'],
        ]} />
      </Card>
    </>
  )
}

function SectionBuscar() {
  return (
    <Card title="Buscar contactos (Apollo.io / RocketReach)" icon={Search}>
      <p>
        Herramienta para encontrar contactos nuevos que todavía no están en el CRM, usando las bases
        externas de Apollo.io y RocketReach.
      </p>
      <FieldTable rows={[
        ['Fuente', 'Ambas, solo Apollo.io o solo RocketReach.'],
        ['Nombre / Empresa / Dominio', 'Al menos uno ayuda a acotar la búsqueda.'],
        ['Cargos objetivo', 'Ej. Director, General Manager, CEO, Commercial Director — separados por coma.'],
        ['Ubicación', 'País o ciudad, ej. México, Spain, United States.'],
      ]} />
      <Tip tone="info">
        Los resultados no se guardan solos en el CRM — revísalos y da de alta manualmente los
        contactos que te sirvan desde "Nuevo contacto", asociándolos a la empresa correspondiente.
      </Tip>
    </Card>
  )
}

function SectionComunicacion({ isSupervisor }) {
  return (
    <>
      <Card title="Regla de canal: Email y Llamada solo desde el Evento" icon={Ban}>
        <Tip tone="danger">
          Por directiva del equipo, <strong>solo se puede enviar email o hacer una llamada desde la
          ficha de un Evento (Deal)</strong>, nunca desde Empresa o Contacto. Así toda comunicación
          queda trazada al evento correspondiente y visible en su pestaña Actividades.
        </Tip>
      </Card>

      <Card title="Redactar email" icon={MailIcon}>
        <FieldTable rows={[
          ['Destinatarios', 'Lista de contactos del evento — clic para agregar o quitar de "Para". El teléfono/email de la propia empresa también puede aparecer como destinatario si la empresa tiene esos datos.'],
          ['Cc', 'Enlace "Cc" (como en Gmail/Outlook) para revelar un segundo campo de copia.'],
          ['Plantilla', 'Elige una plantilla guardada o crea una nueva con "Guardar como plantilla".'],
          ['Formato enriquecido', 'Fuente, negrita, cursiva, subrayado, alineación, viñetas y numeración.'],
          ['Adjuntar archivo', 'Hasta ~2.4 MB combinados — quedan también subidos como archivo en HubSpot.'],
          ['Firma', 'Editor de firma personal (texto, imagen, íconos) — se guarda por usuario y se antepone automáticamente al correo.'],
          ['Enviar', 'Queda registrado en la pestaña Actividades del evento, con destinatario y Cc visibles.'],
        ]} />
      </Card>

      <Card title="Llamada (Click-to-Call)" icon={Phone}>
        <p>El panel "Click-to-Call" a la derecha de la ficha del Evento permite llamar directo desde el navegador, vía Zadarma.</p>
        <FieldTable rows={[
          ['Requisito', 'Tener la app de escritorio Zadarma instalada y conectada con tu extensión SIP (ver sección Administración).'],
          ['Cómo funciona', 'El CRM llama primero a tu extensión (suena tu softphone) → al contestar, Zadarma te conecta con el número del contacto → la llamada se registra sola como actividad.'],
          ['Historial reciente del registro', 'Debajo del botón Llamar — muestra las últimas llamadas relacionadas a ese número.'],
        ]} />
      </Card>

      <Card title="Nota, LinkedIn y Tarea" icon={MessageCircle}>
        <FieldTable rows={[
          ['Nota', 'Texto libre — úsalo para dejar constancia de cualquier gestión (ej. "llamé, no contestó").'],
          ['LinkedIn', 'Registra una gestión hecha por LinkedIn (invitación enviada, mensaje, respuesta).'],
          ['Tarea', 'Crea un pendiente con fecha límite; los supervisores además pueden asignar tareas a cualquier miembro del equipo.'],
        ]} />
      </Card>

      <Card title="Búsqueda global (Ctrl+K)" icon={Search}>
        <p>
          Desde cualquier pantalla, presiona <strong>Ctrl+K</strong> (o clic en la lupa "Buscar
          contactos" del menú, distinta a esta) para abrir el buscador rápido: escribe y verás
          coincidencias de Eventos, Contactos y Empresas al mismo tiempo, agrupadas por tipo.
          Navega con las flechas y abre con Enter.
        </p>
      </Card>
    </>
  )
}

function SectionReportes() {
  return (
    <>
      <Card title="Reportes — Actividad" icon={BarChart2} role="supervisor">
        <p>Actividad de cada operador (llamadas, notas, eventos activos) en el período elegido.</p>
        <FieldTable rows={[
          ['Selector de período', 'Hoy / Esta semana / Este mes / Últimos 90 días.'],
          ['Tarjeta por operador', 'Llamadas, notas y eventos activos, con barra de progreso relativa.'],
          ['Resumen comparativo del equipo', 'Tabla ordenada por actividad total — clic en cualquier número para ver el detalle.'],
          ['Exportar a Excel', 'Descarga el resumen del período seleccionado.'],
        ]} />
      </Card>
      <Card title="Reportes — BePharma" icon={BarChart2} role="supervisor">
        <p>Métricas globales del evento activo (ej. BEPH-2026-09):</p>
        <FieldTable rows={[
          ['Tarjetas KPI', 'Nuevos este mes, Callbacks vencidos, Sin actividad +72h, Confirmadas, Participa otro evento.'],
          ['Distribución por estado de prospección', 'Barra horizontal con el total por cada una de las 7 etapas.'],
          ['Callbacks vencidos por operador', 'Ranking de pendientes vencidos por persona.'],
          ['Sin actividad +72h por operador', 'Ranking de eventos "fríos" por persona — útil para repartir seguimiento.'],
        ]} />
      </Card>
    </>
  )
}

function SectionAdmin() {
  return (
    <>
      <Card title="Estado de integraciones" icon={Settings} role="supervisor">
        <p>Semáforo de las conexiones externas que usa el CRM: HubSpot API, Zadarma API, Apollo.io, RocketReach, Email SMTP y Webhook Token. Botón "Verificar" para refrescar el estado.</p>
      </Card>
      <Card title="Etapas automáticas" icon={Settings} role="supervisor">
        <p>
          Botón "Recalcular etapas ahora" — fuerza una pasada completa que reasigna las 4 primeras
          etapas (Nueva / En Depuración / En Enriquecimiento / Por Contactar) según los datos de
          contacto actuales. Normalmente no hace falta usarlo: el recálculo ya corre solo cada vez
          que se edita una empresa o contacto desde el CRM. Nunca toca eventos en En Seguimiento,
          Confirmada o No Participa — esas etapas son siempre decisión manual.
        </p>
      </Card>
      <Card title="Extensiones SIP (Zadarma)" icon={Phone} role="supervisor">
        <p>Tabla con el usuario, rol, HubSpot Owner ID, extensión SIP y token Zadarma de cada persona del equipo. "Editar ext." para asignar o cambiar la extensión de alguien.</p>
      </Card>
      <Card title="Países asignados por operador" icon={Settings} role="supervisor">
        <p>
          Define qué Empresas, Contactos y Eventos ve cada operador (y también el propietario/owner
          que se les asigna en HubSpot). Un mismo país puede asignarse a más de un operador si así se
          decidió. "Editar países" para agregar o quitar países de la lista de alguien.
        </p>
        <Tip tone="warn">
          Si un operador tiene la sesión abierta cuando le cambias sus países, no verá el cambio
          hasta que cierre sesión y vuelva a entrar.
        </Tip>
      </Card>
      <Card title="Configuración de correo por usuario" icon={MailIcon} role="supervisor">
        <p>Define desde qué buzón sale cada correo enviado por cada persona del equipo. Si alguien no tiene su remitente propio configurado, sus correos salen por un remitente por defecto (se marca con una etiqueta amarilla).</p>
      </Card>
      <Card title="Guía de conexión Zadarma (softphone)" icon={Phone} role="supervisor">
        <FieldTable rows={[
          ['Paso 1', 'Instalar la app de escritorio Zadarma e ingresar servidor sip.zadarma.com, usuario 545494-1XX (la extensión) y el token como contraseña.'],
          ['Paso 2', 'Con la app conectada, el Click-to-Call del CRM funciona: llama primero a tu extensión y luego te conecta con el contacto.'],
        ]} />
      </Card>
      <Card title="Credenciales del portal HubSpot" icon={Settings} role="supervisor">
        <p>Portal ID y tokens de API (HubSpot, Apollo.io, RocketReach) — se muestran enmascarados por seguridad; viven en el archivo de entorno del servidor, no se pueden copiar desde aquí.</p>
      </Card>
      <Card title="Copia de seguridad" icon={Settings} role="supervisor">
        <p>Descarga manual (Excel o JSON) de Empresas, Contactos y Eventos, más la configuración propia del CRM (usuarios, países, extensiones, firmas, plantillas — nunca contraseñas). Además, cada lunes a las 08:00 UTC se genera y envía automáticamente por correo a los supervisores.</p>
      </Card>
    </>
  )
}

function SectionFAQ({ isSupervisor }) {
  const faqs = [
    ['¿Qué significan las alertas amarilla y roja?', 'Señalan eventos que necesitan atención (por ejemplo, mucho tiempo sin actividad o callback vencido). La alerta amarilla es una advertencia; la roja es más urgente.'],
    ['¿Por qué no veo los botones Alerta o Eliminar en un Evento?', 'Son exclusivos del rol Supervisor. Si eres operador, no aparecen en tu vista — es el comportamiento esperado.'],
    ['¿Puedo escribir un email o llamar desde la ficha de Empresa o Contacto?', 'No. Por diseño, esas acciones solo existen dentro de la ficha del Evento, para que toda comunicación quede trazada a un evento concreto.'],
    ['¿Qué es "Lista negra" en una Empresa?', 'Un marcador visual/manual para excluir a esa empresa de futuras listas de prospección. No la elimina ni bloquea nada automáticamente — solo la oculta por defecto en el listado de Empresas.'],
    ['¿Qué es el banner "Participó antes" en una Empresa?', 'Indica que esa empresa ya tuvo al menos un Evento (deal) en un ciclo BePharma anterior.'],
    ['El Kanban dice "más de 500 registros", ¿qué hago?', 'Es solo un límite visual de esa vista. Usa el listado ("Mis eventos" / "Todos los eventos") con los filtros de estado/país/operador para ver o trabajar el resto.'],
    ['¿Cómo cambio mi contraseña?', 'Icono de llave 🔑 junto a tu nombre, abajo del menú lateral.'],
    ['¿Cuál es el atajo para buscar rápido en todo el CRM?', 'Ctrl+K desde cualquier pantalla — busca a la vez en Eventos, Contactos y Empresas.'],
    ...(isSupervisor ? [
      ['¿Cómo veo el CRM igual que lo ve un operador?', 'Desde el Dashboard hay un toggle de "vista operador" — te muestra el menú y los permisos exactos de un operador, sin perder tu rol real.'],
      ['¿Dónde configuro las extensiones SIP y los países de cada operador?', 'En Administración → "Extensiones SIP" y "Países asignados por operador".'],
    ] : []),
  ]
  return (
    <Card title="Preguntas frecuentes" icon={HelpCircle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {faqs.map(([q, a], i) => (
          <div key={i}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{q}</div>
            <div style={{ fontSize: 12.5, color: '#546e7a' }}>{a}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------

const ALL_SECTIONS = [
  { id: 'intro',         label: 'Introducción',        icon: Info,          roles: ['operator', 'supervisor'], Comp: SectionIntro },
  { id: 'dashboard',     label: 'Dashboard',            icon: LayoutDashboard, roles: ['operator', 'supervisor'], Comp: SectionDashboard },
  { id: 'eventos',       label: 'Eventos',               icon: Briefcase,     roles: ['operator', 'supervisor'], Comp: SectionEventos },
  { id: 'empresas',      label: 'Empresas',              icon: Building2,     roles: ['operator', 'supervisor'], Comp: SectionEmpresas },
  { id: 'kanban',        label: 'Pipeline de Eventos',   icon: Kanban,        roles: ['operator', 'supervisor'], Comp: SectionKanban },
  { id: 'contactos',     label: 'Contactos',             icon: Users,         roles: ['operator', 'supervisor'], Comp: SectionContactos },
  { id: 'buscar',        label: 'Buscar contactos',      icon: Search,        roles: ['operator', 'supervisor'], Comp: SectionBuscar },
  { id: 'comunicacion',  label: 'Comunicación',          icon: Phone,         roles: ['operator', 'supervisor'], Comp: SectionComunicacion },
  { id: 'reportes',      label: 'Reportes',              icon: BarChart2,     roles: ['supervisor'],             Comp: SectionReportes },
  { id: 'admin',         label: 'Administración',        icon: Settings,      roles: ['supervisor'],             Comp: SectionAdmin },
  { id: 'faq',           label: 'Preguntas frecuentes',  icon: HelpCircle,    roles: ['operator', 'supervisor'], Comp: SectionFAQ },
]

export default function HelpPage() {
  const { user } = useAuth()
  const isSupervisor = user?.role === 'supervisor'
  const roleKey = isSupervisor ? 'supervisor' : 'operator'
  const sections = ALL_SECTIONS.filter(s => s.roles.includes(roleKey))
  const [active, setActive] = useState('intro')
  const current = sections.find(s => s.id === active) || sections[0]
  const CurrentComp = current.Comp

  return (
    <>
      <Topbar title="Ayuda y guía de uso" />
      <div className="content">
        <div className="card" style={{ marginBottom: 20, background: '#0d1e2e', border: 'none' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#e0f7fa' }}>
            <HelpCircle size={20} style={{ color: '#4fc3f7', flexShrink: 0 }} />
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Guía de autoaprendizaje de BePharma CRM, adaptada a tu rol actual:{' '}
              <strong style={{ color: '#4fc3f7' }}>{isSupervisor ? 'Supervisor' : 'Operador'}</strong>.
              Elige un módulo del menú para ver cómo usarlo.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <nav style={{ width: 220, flexShrink: 0, position: 'sticky', top: 0 }}>
            <div className="card" style={{ padding: 6 }}>
              {sections.map(s => {
                const Icon = s.icon
                const isActive = s.id === active
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                      padding: '9px 12px', borderRadius: 6, background: isActive ? '#eaf6fd' : 'transparent',
                      color: isActive ? '#0369a1' : '#374151', fontWeight: isActive ? 700 : 500, fontSize: 12.5,
                      marginBottom: 2,
                    }}
                  >
                    <Icon size={14} style={{ flexShrink: 0 }} /> {s.label}
                  </button>
                )
              })}
            </div>
          </nav>

          <div style={{ flex: 1, minWidth: 0 }}>
            <CurrentComp isSupervisor={isSupervisor} />
          </div>
        </div>
      </div>
    </>
  )
}
