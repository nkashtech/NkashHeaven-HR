import { useCallback, useEffect, useRef, useState } from 'react'
import api, { errorMessage, recent } from '../services/api'

// GET with loading, error and reload. Passing a null url skips the request.
// A page seen before shows its last data at once and refreshes behind it.
export function useFetch(url) {
  const [data, setState] = useState(() => recent.get(url) ?? null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(Boolean(url))
  const latest = useRef(0)
  const held = useRef(data)

  const setData = useCallback((next) => {
    setState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      held.current = value
      if (url) recent.set(url, value)
      return value
    })
  }, [url])

  const reload = useCallback(async () => {
    if (!url) return null
    const ticket = ++latest.current
    setLoading(true)
    try {
      const res = await api.get(url)
      if (ticket === latest.current) {
        // An identical answer keeps the same object, so a form already open isn't reset under someone typing.
        if (JSON.stringify(res.data) !== JSON.stringify(held.current)) setData(res.data)
        setError(null)
      }
      return res.data
    } catch (err) {
      if (ticket === latest.current) setError(errorMessage(err))
      return null
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [url, setData])

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
