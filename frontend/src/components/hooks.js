import { useCallback, useEffect, useRef, useState } from 'react'
import api, { errorMessage } from '../services/api'

// GET with loading, error and reload. Passing a null url skips the request.
export function useFetch(url) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(Boolean(url))
  const latest = useRef(0)

  const reload = useCallback(async () => {
    if (!url) return null
    const ticket = ++latest.current
    setLoading(true)
    try {
      const res = await api.get(url)
      if (ticket === latest.current) { setData(res.data); setError(null) }
      return res.data
    } catch (err) {
      if (ticket === latest.current) setError(errorMessage(err))
      return null
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [url])

  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload, setData }
}

export function useInterval(fn, ms) {
  const saved = useRef(fn)
  saved.current = fn
  useEffect(() => {
    if (!ms) return undefined
    const id = setInterval(() => saved.current(), ms)
    return () => clearInterval(id)
  }, [ms])
}
