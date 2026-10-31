import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

// Type a name and matching people drop down, like Odoo's many2one field.
export default function PersonPicker({ people, value, onChange, placeholder = 'Type a name', label = 'Person' }) {
  const picked = people.find((p) => p.id === Number(value))
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef(null)

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase()
    const rank = (p) => (p.name.toLowerCase().startsWith(n) ? 0 : 1)
    return people.filter((p) => !n || `${p.name} ${p.jobTitle || ''}`.toLowerCase().includes(n)).sort((a, b) => rank(a) - rank(b)).slice(0, 8)
  }, [people, q])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const choose = (p) => { onChange(p.id); setQ(''); setOpen(false) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]) }
    if (e.key === 'Escape') setOpen(false)
  }
  if (picked) {
    return (
      <div className="input flex items-center justify-between">
        <span className="truncate">{picked.name}</span>
        <button type="button" aria-label={`Clear ${label}`} className="text-ink-muted hover:text-ink" onClick={() => onChange('')}><X size={14} /></button>
      </div>
    )
  }
  return (
    <div className="relative" ref={box}>
      <input className="input" role="combobox" aria-expanded={open} aria-label={label} placeholder={placeholder} value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onKeyDown={onKey} autoComplete="off" />
      {open && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-card py-1 shadow-pop">
          {!matches.length && <li className="px-3 py-2 text-[13px] text-ink-muted">Nobody by that name</li>}
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); choose(p) }} className={`block w-full px-3 py-1.5 text-left text-[13px] ${i === active ? 'bg-subtle' : ''}`}>
                <span className="font-semibold">{p.name}</span>{p.jobTitle && <span className="ml-1.5 text-xs text-ink-muted">{p.jobTitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
