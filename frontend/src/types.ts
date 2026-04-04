export type ArtifactType =
  | 'application/vnd.ant.react'
  | 'image/svg+xml'
  | 'application/vnd.ant.mermaid'
  | 'text/html'
  | 'application/vnd.ant.code'
  | 'text/markdown'
  | 'image/surface'
  | 'image/generated'

export interface Artifact {
  identifier: string
  type: ArtifactType
  title: string
  content: string
  language?: string
  src?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  artifact?: Artifact
}

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}
