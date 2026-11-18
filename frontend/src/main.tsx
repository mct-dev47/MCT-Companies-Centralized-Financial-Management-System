import '@/lib/validation/zod'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './globals.css'
import App from './App'

// Automatically recover when a new deployment invalidates cached chunk hashes
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const reloadKey = 'last_chunk_reload'
  const lastReload = Number(sessionStorage.getItem(reloadKey) || '0')
  const now = Date.now()
  // Prevent infinite reload loops if server is completely unreachable
  if (now - lastReload > 5000) {
    sessionStorage.setItem(reloadKey, String(now))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
