import axios from 'axios'

// VITE_API_URL points at the API when it's hosted apart from this app. Left empty, it's the same site.
export const API_URL = import.meta.env.VITE_API_URL || '/api'
export const SOCKET_URL = API_URL.startsWith('http') ? new URL(API_URL).origin : undefined

const api = axios.create({ baseURL: API_URL, timeout: 30000 })

// "Keep me signed in" stores the session in localStorage, otherwise sessionStorage.
export const session = {
  get token() {
    return sessionStorage.getItem('token') || localStorage.getItem('token')
  },
  save(token, remember) {
    this.clear()
    ;(remember ? localStorage : sessionStorage).setItem('token', token)
  },
  clear() {
    localStorage.removeItem('token')
    sessionStorage.removeItem('token')
  },
}

api.interceptors.request.use((config) => {
  const token = session.token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Which company's sign-in this browser last used.
export const company = {
  get slug() { return localStorage.getItem('company') },
  set(slug) { if (slug) localStorage.setItem('company', slug); else localStorage.removeItem('company') },
}
export const loginPath = () => (company.slug ? `/c/${company.slug}/login` : '/login')

const isPublic = (path) => ['/login', '/forgot-password', '/reset-password'].some((p) => path.endsWith(p)) || path.startsWith('/card/')

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    if (status === 401 && session.token && !isPublic(window.location.pathname)) {
      session.clear()
      window.location.href = loginPath()
    }
    return Promise.reject(error)
  },
)

export const errorMessage = (err, fallback = 'Something went wrong') => err.response?.data?.error || (err.code === 'ERR_NETWORK' ? 'Cannot reach the server' : fallback)

// Authenticated file download: the browser can't attach the token to a plain link.
export async function download(url, fallbackName, config = {}) {
  const res = await api.request({ url, method: 'get', responseType: 'blob', ...config })
  const disposition = res.headers['content-disposition'] || ''
  const name = decodeURIComponent(disposition.match(/filename="?([^";]+)"?/)?.[1] || fallbackName)
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  URL.revokeObjectURL(href)
}

export async function uploadFile(file, purpose) {
  const form = new FormData()
  form.append('file', file)
  form.append('purpose', purpose)
  const { data } = await api.post('/files', form)
  return data.file
}

export default api
