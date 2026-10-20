const RELOAD_KEY = 'chunk-reload-at'
const RELOAD_WINDOW_MS = 10000
let reloading = false

export function isChunkLoadError(error) {
  const msg = String((error && (error.message || error)) || '')
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk .* failed|Unable to preload CSS/i.test(msg)
}

// True if a reload has already been triggered during this page load.
export function isReloading() {
  return reloading
}

// Reloads the page at most once per RELOAD_WINDOW_MS. Returns true if a reload was triggered.
export function reloadOnceForChunkError() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    reloading = true
    window.location.reload()
    return true
  } catch (e) {
    return false
  }
}
