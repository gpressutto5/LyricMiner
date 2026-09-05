import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
      <Toaster />
    </TooltipProvider>
  </React.StrictMode>,
)
