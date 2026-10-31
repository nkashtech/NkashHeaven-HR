import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CameraOff } from 'lucide-react'
import jsQR from 'jsqr'
import { Avatar } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { fmtTime } from '../../utils/format'
import api, { errorMessage } from '../../services/api'
import { Logo } from '../../components/Layout'

const RESULT_MS = 4000

// A shared device at the entrance. A camera reads the QR; a USB scanner types the code and Enter into the box.
export default function Kiosk() {
  const { user } = useAuth()
  const [result, setResult] = useState(null)
  const [camera, setCamera] = useState('idle')
  const [code, setCode] = useState('')
  const video = useRef(null)
  const canvas = useRef(null)
  const input = useRef(null)
  const busy = useRef(false)

  const scan = useCallback(async (token) => {
    if (busy.current || !token) return
    busy.current = true
    try {
      const { data } = await api.post('/attendance/scan', { token })
      setResult(data)
    } catch (err) {
      setResult({ error: errorMessage(err, 'That card could not be read') })
    }
    setTimeout(() => { setResult(null); busy.current = false; input.current?.focus() }, RESULT_MS)
  }, [])

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      video.current.srcObject = stream
      await video.current.play()
      setCamera('on')
    } catch {
      setCamera('blocked')
    }
  }, [])

  useEffect(() => {
    start()
    const v = video.current
    return () => v?.srcObject?.getTracks().forEach((t) => t.stop())
  }, [start])

  useEffect(() => {
    if (camera !== 'on') return undefined
    let frame
    let last = 0
    const tick = (t) => {
      frame = requestAnimationFrame(tick)
      const v = video.current
      if (t - last < 200 || !v?.videoWidth || busy.current) return
      last = t
      const c = canvas.current
      c.width = v.videoWidth
      c.height = v.videoHeight
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(v, 0, 0)
      const hit = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)
      if (hit?.data) scan(hit.data)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [camera, scan])

  const submit = (e) => {
    e.preventDefault()
    scan(code)
    setCode('')
  }
  const tone = result?.error ? 'bg-bad-soft text-bad' : result?.action === 'out' ? 'bg-info-soft text-info' : result?.action === 'repeat' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'
  return (
    <div className="flex min-h-full flex-col bg-panel p-6">
      <div className="flex items-center justify-between">
        <Logo />
        <Link to="/" className="link inline-flex items-center gap-1"><ArrowLeft size={14} />Exit kiosk</Link>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <h1 className="text-3xl font-bold tracking-tight">{user.company?.name}: scan your card</h1>
        <div className="relative aspect-[4/3] w-full max-w-xl overflow-hidden rounded-2xl bg-subtle">
          <video ref={video} muted playsInline className={`h-full w-full object-cover ${camera === 'on' ? '' : 'hidden'}`} />
          <canvas ref={canvas} className="hidden" />
          {camera !== 'on' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-soft">
              {camera === 'blocked' ? <CameraOff size={32} /> : <Camera size={32} />}
              <p className="text-[13px]">{camera === 'blocked' ? 'No camera available. Allow camera access, or use a USB scanner below. Cameras need a secure https address.' : 'Starting the camera…'}</p>
              {camera === 'blocked' && <button className="btn-outline" onClick={start}>Try again</button>}
            </div>
          )}
          {result && (
            <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center ${tone}`} role="status">
              {result.error ? <p className="text-2xl font-bold">{result.error}</p> : (
                <>
                  <Avatar name={result.name} size={96} photoFileId={result.photoFileId} />
                  <p className="text-3xl font-bold">{result.action === 'in' ? `Welcome, ${result.name.split(' ')[0]}` : result.action === 'out' ? `Goodbye, ${result.name.split(' ')[0]}` : `Already scanned, ${result.name.split(' ')[0]}`}</p>
                  {result.at && <p className="text-lg">{result.action === 'in' ? 'Checked in' : 'Checked out'} at {fmtTime(result.at)}</p>}
                </>
              )}
            </div>
          )}
        </div>
        <form onSubmit={submit} className="flex w-full max-w-xl gap-2">
          <input ref={input} autoFocus className="input" placeholder="Or scan with a USB scanner, or type the card code" aria-label="Card code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-primary">Scan</button>
        </form>
      </div>
    </div>
  )
}
