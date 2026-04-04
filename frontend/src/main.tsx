import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ChatSessionsProvider } from './contexts/ChatSessionsContext'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ChatSessionsProvider>
        <App />
      </ChatSessionsProvider>
    </BrowserRouter>
  </StrictMode>,
)
