import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)        // { username, name, role, ownerId }
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(true)  // verificando sesión al arrancar

  // Al montar, revisar si hay token guardado
  useEffect(() => {
    const saved = sessionStorage.getItem('bp_token')
    if (saved) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${saved}`
      axios.get('/api/auth/me')
        .then(r => { setToken(saved); setUser(r.data.user) })
        .catch(() => { sessionStorage.removeItem('bp_token') })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const r = await axios.post('/api/auth/login', { username, password })
    const { token: t, user: u } = r.data
    sessionStorage.setItem('bp_token', t)
    axios.defaults.headers.common['Authorization'] = `Bearer ${t}`
    // Vista inicial al iniciar sesión: si el usuario tiene defaultView configurado
    // (ej. Yesenia = 'operator'), arrancar en esa vista en vez de la vista por rol.
    if (u.defaultView === 'operator') {
      sessionStorage.setItem('bp_view_mode', 'operator')
    } else {
      sessionStorage.removeItem('bp_view_mode')
    }
    window.dispatchEvent(new Event('bpViewModeChange'))
    setToken(t)
    setUser(u)
    return u
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem('bp_token')
    sessionStorage.removeItem('bp_view_mode')
    delete axios.defaults.headers.common['Authorization']
    window.dispatchEvent(new Event('bpViewModeChange'))
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthCtx.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  return useContext(AuthCtx)
}
