import { createContext, useContext, useState } from 'react'
import type { Message, Artifact } from '@/types'

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

export function ChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>([])

  function addSession(id: string, title: string) {
    setSessions(prev => {
      if (prev.some(s => s.id === id)) return prev
      return [{ id, title: title.slice(0, 60), createdAt: Date.now(), messages: [], activeArtifact: null }, ...prev]
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
