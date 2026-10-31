// Any button that starts an API call shows a spinner and ignores clicks until the call finishes, so no page has to wire this up itself.
const WINDOW_MS = 500
const SKIP = '[role="tab"], [role="switch"]'
let last = null
let at = 0

document.addEventListener('click', (e) => {
  const button = e.target.closest?.('button')
  if (!button) return
  if (button.dataset.busy) {
    e.preventDefault()
    e.stopPropagation()
  } else if (!button.matches(SKIP)) {
    last = button
    at = performance.now()
  }
}, true)

const counts = new WeakMap()

export function startBusy() {
  if (!last?.isConnected || performance.now() - at > WINDOW_MS) return null
  const button = last
  counts.set(button, (counts.get(button) || 0) + 1)
  button.style.setProperty('--busy-color', getComputedStyle(button).color)
  button.dataset.busy = 'true'
  button.setAttribute('aria-busy', 'true')
  return button
}

export function stopBusy(button) {
  if (!button) return
  const left = counts.get(button) - 1
  counts.set(button, left)
  if (left > 0) return
  delete button.dataset.busy
  button.removeAttribute('aria-busy')
}
