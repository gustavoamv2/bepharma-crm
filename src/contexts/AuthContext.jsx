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
    setToken(t)
    setUser(u)
    return u
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem('bp_token')
    delete axios.defaults.headers.common['Authorization']
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
