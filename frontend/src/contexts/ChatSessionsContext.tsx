import { createContext, useContext, useState, useEffect } from 'react'
import type { Message, Artifact } from '@/types'

const STORAGE_KEY = 'prox-sessions'

interface ChatSession {
  id: string
  title: string
  createdAt: number
  messages: Message[]
  activeArtifact: Artifact | null
}

interface ChatSessionsContextValue {
  sessions: ChatSession[]
  addSession: (id: string, title: string) => void
  updateSession: (id: string, messages: Message[], activeArtifact: Artifact | null) => void
  getSession: (id: string) => ChatSession | undefined
}

const ChatSessionsContext = createContext<ChatSessionsContextValue | null>(null)

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function ChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions)

  useEffect(() => {
    // Strip image blobs before persisting — base64 data URLs blow the quota
    const toSave = sessions.map(s => ({
      ...s,
      messages: s.messages.map(m => ({
        ...m,
        imageData: undefined,
        imagePreview: undefined,
      })),
    }))
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    } catch {
      // Still over quota (large artifact content) — evict oldest sessions and retry
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave.slice(0, 5)))
      } catch { /* give up — don't crash */ }
    }
  }, [sessions])

  function addSession(id: string, title: string) {
    setSessions(prev => {
      if (prev.some(s => s.id === id)) return prev
      return [{ id, title: title.slice(0, 60), createdAt: Date.now(), messages: [], activeArtifact: null }, ...prev].slice(0, 10)
    })
  }

  function updateSession(id: string, messages: Message[], activeArtifact: Artifact | null) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, messages, activeArtifact } : s))
  }

  function getSession(id: string) {
    return sessions.find(s => s.id === id)
  }

  return (
    <ChatSessionsContext.Provider value={{ sessions, addSession, updateSession, getSession }}>
      {children}
    </ChatSessionsContext.Provider>
  )
}

export function useChatSessions() {
  const ctx = useContext(ChatSessionsContext)
  if (!ctx) throw new Error('useChatSessions must be used within ChatSessionsProvider')
  return ctx
}
