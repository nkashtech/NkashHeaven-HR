import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api, { company, loginPath, session } from '../services/api'
import { setDateFormat } from '../utils/format'
import { applyLanguage } from '../i18n'

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const mix = (rgb, to, amount) => rgb.map((c, i) => Math.round(c + (to[i] - c) * amount)).join(' ')
const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]

// The company colour replaces the orange everywhere, in light and dark.
export function applyBrand(hex) {
  let tag = document.getElementById('company-theme')
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) { tag?.remove(); return }
  const rgb = hexToRgb(hex)
  const light = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 165
  if (!tag) {
    tag = document.createElement('style')
    tag.id = 'company-theme'
    document.head.appendChild(tag)
  }
  tag.textContent = `:root{--brand:${rgb.join(' ')};--brand-bright:${mix(rgb, WHITE, 0.25)};--brand-soft:${mix(rgb, WHITE, 0.9)};--brand-ink:${mix(rgb, BLACK, 0.2)};--on-brand:${light ? '24 24 27' : '255 255 255'}}
html.dark{--brand:${mix(rgb, WHITE, 0.2)};--brand-bright:${mix(rgb, WHITE, 0.35)};--brand-soft:${mix(rgb, BLACK, 0.72)};--brand-ink:${mix(rgb, WHITE, 0.5)};--on-brand:24 24 27}`
}

function applyUser(user) {
  applyTheme(user.theme)
  setDateFormat(user.dateFormat)
  applyLanguage(user.language)
  applyBrand(user.branding?.primaryColor)
  company.set(user.company?.isPlatform ? null : user.company?.slug)
}

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function applyTheme(theme) {
  localStorage.setItem('theme', theme)
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(session.token))

  const refresh = useCallback(async () => {
    const { data } = await api.get('/auth/me')
    setUser(data.user)
    applyUser(data.user)
    return data.user
  }, [])

  useEffect(() => {
    if (!session.token) return
    refresh().catch(() => session.clear()).finally(() => setLoading(false))
  }, [refresh])

  const login = useCallback(async (payload) => {
    const { data } = await api.post('/auth/login', payload)
    if (data.twoFactorRequired) return data
    session.save(data.token, payload.remember)
    setUser(data.user)
    applyUser(data.user)
    return data
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    session.clear()
    setUser(null)
    window.location.href = loginPath()
  }, [])

  const value = useMemo(() => ({
    user, loading, login, logout, refresh, setUser,
    can: (key) => Boolean(user?.permissions?.[key]),
    isAdmin: user?.role === 'ADMIN',
    isSuper: user?.role === 'SUPER_ADMIN',
    isLead: Boolean(user?.permissions?.['leave.approve'] || user?.permissions?.['timesheets.validate']),
  }), [user, loading, login, logout, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
