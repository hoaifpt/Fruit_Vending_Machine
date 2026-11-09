import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import './index.css'
import App from './App.tsx'

// Must finish before the first render so no request reaches the network. Without VITE_API_MOCK this block is dropped from the bundle.
if (import.meta.env.VITE_API_MOCK) {
  const { installMock } = await import('./api/mock/index.ts')
  installMock(import.meta.env.VITE_API_MOCK)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
