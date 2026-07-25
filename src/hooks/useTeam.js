import { useMemo } from 'react'
import { useQuery } from 'react-query'
import { team as teamApi } from './useApi'

// Equipo del CRM desde /api/team. Reemplaza los mapas OWNER_NAMES que estaban
// copiados a mano en cada pagina: un usuario dado de alta desde Administracion
// aparece solo, sin tocar codigo.
//
// La lista incluye a los usuarios desactivados (con disabled:true) para que los
// registros historicos sigan mostrando el nombre de su propietario. Quien
// ofrezca asignar trabajo nuevo debe filtrarlos.
export function useTeam() {
  const { data } = useQuery('team', teamApi.list, { staleTime: 5 * 60_000 })
  return data || []
}

// Mapa ownerId -> nombre, para resolver el propietario de un registro.
export function useOwnerNames() {
  const team = useTeam()
  return useMemo(
    () => Object.fromEntries(team.filter(m => m.ownerId).map(m => [m.ownerId, m.name])),
    [team]
  )
}

// Miembros con owner de HubSpot, en el orden en que estan definidos. Sirve para
// los desplegables de "filtrar por operador" y para las tablas comparativas por
// operador de Reportes; los desactivados se marcan pero no se ocultan, porque
// sus registros siguen existiendo y hay que poder filtrarlos.
export function useOwners() {
  const team = useTeam()
  return useMemo(() => team.filter(m => m.ownerId), [team])
}
