# BePharma CRM — Instrucciones de inicio

## Usuarios y contraseñas iniciales

Cada miembro del equipo tiene su propio acceso. Las contraseñas son temporales — se recomienda cambiarlas editando `api/users.json` con el script `api/setup-passwords.js`.

| Usuario   | Contraseña inicial | Rol         | Zona                          |
|-----------|-------------------|-------------|-------------------------------|
| roberto   | roberto2026       | Supervisor  | Dirección general             |
| yesenia   | yesenia2026       | Supervisora | EEUU, Europa Occ, LATAM Norte |
| angel     | angel2026         | Operador    | Europa del Este, Medio Oriente|
| gracie    | gracie2026        | Operadora   | Asia Pacífico, Oceanía        |
| carlos    | carlos2026        | Operador    | LATAM Sur, Caribe             |
| sara      | sara2026          | Operadora   | África, Asia Central          |

**Supervisores** (Roberto, Yesenia): ven métricas de todo el equipo, todos los negocios/empresas/contactos.  
**Operadores** (Angel, Gracie, Carlos, Sara): ven únicamente sus registros asignados y sus tareas pendientes.

---

## 1. Configurar credenciales

Copia el archivo de ejemplo y llena tus claves:

```bash
cd "06-Plan Migracion HubSpot\bepharma-crm"
copy .env.example .env
```

Luego abre `.env` y rellena:

```
HUBSPOT_ACCESS_TOKEN=pat-na1-TU-TOKEN-AQUI
HUBSPOT_PORTAL_ID=51580878
ZADARMA_API_KEY=TU-KEY
ZADARMA_API_SECRET=TU-SECRET
APOLLO_API_KEY=TU-KEY
ROCKETREACH_API_KEY=TU-KEY
```

### Cómo obtener el token de HubSpot
1. HubSpot → Configuración (⚙) → Integraciones → Aplicaciones privadas
2. Crear aplicación privada
3. Permisos necesarios: `crm.objects.deals.read`, `crm.objects.companies.read`, `crm.objects.contacts.read/write`, `crm.schemas.deals.read`, `sales-email-read`
4. Copiar el token generado

## 2. Instalar dependencias

```bash
cd "06-Plan Migracion HubSpot\bepharma-crm"
npm install
```

## 3. Iniciar la aplicación

```bash
npm run dev
```

Esto arranca:
- **Backend** (Express) en `http://localhost:3001`
- **Frontend** (React/Vite) en `http://localhost:5173`

Abre `http://localhost:5173` en tu navegador.

## Funcionalidades

### Dashboard
- Métricas en tiempo real: sin actividad 72h, nuevos del mes, sin próximo contacto, callbacks vencidos
- Clic en cualquier métrica → abre la lista de negocios filtrada

### Negocios
- Lista con filtros por etapa y zona (bp_zona)
- Búsqueda por nombre
- Clic en un negocio → detalle completo con propiedades BePharma
- Historial de actividades (notas, llamadas, tareas)
- Click-to-call Zadarma desde el detalle

### Empresas y Contactos
- Lista con búsqueda
- Detalle con click-to-call Zadarma
- Navegación a registros asociados

### Buscar Contactos (Apollo / RocketReach)
- Busca por nombre, empresa y cargo
- Alterna entre Apollo.io y RocketReach
- Botón "Importar" → crea el contacto directamente en HubSpot

## Zadarma Click-to-Call

El widget de llamada usa el API de callback de Zadarma:
- Ingresa el número de destino (o se pre-llena con el teléfono del registro)
- Clic "Llamar" → Zadarma llama primero a tu extensión, luego al destino

Para esto necesitas tener configuradas las extensiones SIP en Zadarma.
El campo "from" debe ser tu extensión SIP (puedes hardcodearlo en `.env` como `ZADARMA_SIP_EXTENSION=100`).
