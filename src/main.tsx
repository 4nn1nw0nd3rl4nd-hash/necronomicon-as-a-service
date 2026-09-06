import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './style.css'
import App from './App.tsx'
import AuthProvider from './auth/AuthProvider'
import { isProductionEnvironment } from './lib/environment'

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')

if (favicon) {
  favicon.href = `${import.meta.env.BASE_URL}${
    isProductionEnvironment ? 'favicon.png' : 'favicon-staging.png'
  }`
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
