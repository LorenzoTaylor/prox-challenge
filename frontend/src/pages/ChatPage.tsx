import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, Artifact } from '@/types'
import { parseArtifact } from '@/utils/parseArtifact'
import { ArtifactPanel } from '@/components/ArtifactPanel'
import { ChatInput } from '@/components/ChatInput'
import { SparkleIcon } from '@/components/SparkleIcon'
import { VoicePanel } from '@/components/VoicePanel'
import { useChatSessions } from '@/contexts/ChatSessionsContext'
import { useVoice } from '@/hooks/useVoice'

function filterStreamingContent(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thinking>[\s\S]*$/, '')
    .replace(/<antArtifact[\s\S]*?<\/antArtifact>/gi, '')
    .replace(/<antArtifact[\s\S]*$/, '')
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
    .replace(/<function_calls>[\s\S]*$/, '')
    .trim()
}

function GeneratingPanel() {
  return (
    <div className="h-full flex items-center justify-center animate-fade-in">
      <div className="flex items-center gap-3">
        <h2 className="text-6xl tracking-tight" style={{ fontFamily: 'Instrument Serif, serif' }}>
          Generating
        </h2>
        <SparkleIcon className="w-12 h-12 shrink-0" loop />
      </div>
    </div>
  )
}

function GeneratingInline() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground py-1">
      <span style={{ fontFamily: 'Instrument Serif, serif', fontSize: '1rem' }}>Generating</span>
      <SparkleIcon className="w-4 h-4 shrink-0" loop />
    </div>
  )
}

// Resolve `src="user-upload"` in image/surface artifacts to the actual data URL
// by finding the most recent user message that had an image attached.
function resolveArtifact(artifact: Artifact, messages: Message[]): Artifact {
  if (artifact.type !== 'image/surface' || artifact.src !== 'user-upload') return artifact
  const preview = [...messages].reverse().find(m => m.role === 'user' && m.imagePreview)?.imagePreview
  if (!preview) return artifact
  return { ...artifact, src: preview }
}

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const location = useLocation()
  const { addSession, updateSession, getSession } = useChatSessions()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const [voiceMode, setVoiceMode] = useState(false)
  const [pendingImage, setPendingImage] = useState<{ preview: string; data: string; mediaType: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const sessionRegistered = useRef(false)
  const shouldAutoSubmit = useRef(false)
  const pendingVoiceSpeak = useRef<string | null>(null)
  // Maps message id → preview data URL so image/surface src="user-upload" can be resolved
  const uploadedImagePreviews = useRef<Map<string, string>>(new Map())

  const handleVoiceTranscript = useCallback((text: string) => {
    setInput(text)
  }, [])

  const voice = useVoice({ onTranscript: handleVoiceTranscript })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // On mount: restore existing session OR seed from router state for a new chat
  useEffect(() => {
    const existing = getSession(chatId!)
    if (existing && existing.messages.length > 0) {
      setMessages(existing.messages)
      setActiveArtifact(existing.activeArtifact)
      sessionRegistered.current = true
      return
    }
    const state = location.state as { initialMessage?: string; voiceMode?: boolean; pendingImage?: { preview: string; data: string; mediaType: string } } | null
    if (state?.voiceMode) {
      setVoiceMode(true)
      voice.resetToIdle()
    }
    if (state?.pendingImage) {
      setPendingImage(state.pendingImage)
    }
    if (state?.initialMessage) {
      setInput(state.initialMessage)
      shouldAutoSubmit.current = true
    }
    window.history.replaceState({}, '')
  }, [])

  useEffect(() => {
    if (shouldAutoSubmit.current && input && messages.length === 0) {
      shouldAutoSubmit.current = false
      handleSubmit()
    }
  }, [input])

  // Auto-submit when voice transcript arrives (voice.voiceState becomes 'thinking')
  useEffect(() => {
    if (voice.voiceState === 'thinking' && input && !streaming) {
      handleSubmit()
    }
  }, [voice.voiceState, input])

  // Persist messages to context whenever streaming ends
  useEffect(() => {
    if (!streaming && messages.length > 0 && chatId) {
      updateSession(chatId, messages, activeArtifact)
    }
    // Trigger TTS after stream completes
    if (!streaming && pendingVoiceSpeak.current) {
      const text = pendingVoiceSpeak.current
      pendingVoiceSpeak.current = null
      voice.speak(text)
    }
  }, [streaming])

  async function handleSubmit() {
    const trimmed = input.trim()
    if (!trimmed || streaming) return

    if (!sessionRegistered.current && chatId) {
      addSession(chatId, trimmed)
      sessionRegistered.current = true
    }

    const userMsgId = crypto.randomUUID()
    const userMsg: Message = {
      id: userMsgId,
      role: 'user',
      content: trimmed,
      ...(pendingImage && {
        imageData: pendingImage.data,
        imageMediaType: pendingImage.mediaType,
        imagePreview: pendingImage.preview,
      }),
    }
    if (pendingImage) {
      uploadedImagePreviews.current.set(userMsgId, pendingImage.preview)
      setPendingImage(null)
    }

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
    }

    const nextMessages = [...messages, userMsg]
    setMessages([...nextMessages, assistantMsg])
    setInput('')
    setStreaming(true)

    try {
      const panel = rightPanelRef.current
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.imageData && { image_data: m.imageData, image_media_type: m.imageMediaType }),
          })),
          panel_width: panel ? Math.round(panel.offsetWidth) : undefined,
          panel_height: panel ? Math.round(panel.offsetHeight) : undefined,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Server error ${res.status}: ${text}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          let parsed: { type: string; text?: string; message?: string }
          try { parsed = JSON.parse(raw) } catch { continue }

          if (parsed.type === 'delta' && parsed.text) {
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content: last.content + parsed.text }
              }
              return updated
            })
          } else if (parsed.type === 'done') {
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                const stripped = last.content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
                const { cleanText, artifact } = parseArtifact(stripped)
                updated[updated.length - 1] = { ...last, content: cleanText, artifact: artifact ?? undefined }
                if (artifact) setActiveArtifact(resolveArtifact(artifact, updated))
                if (voiceMode && cleanText) pendingVoiceSpeak.current = cleanText
              }
              return updated
            })
            break
          } else if (parsed.type === 'error') {
            throw new Error(parsed.message ?? 'Stream error')
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: last.content + `\n\n[Error: ${err instanceof Error ? err.message : String(err)}]`,
          }
        }
        return updated
      })
    } finally {
      setStreaming(false)
    }
  }

  const lastContent = messages[messages.length - 1]?.content ?? ''
  const isGeneratingArtifact = streaming && lastContent.includes('<antArtifact')
  const showRightPanel = activeArtifact !== null || isGeneratingArtifact

  const enterVoiceMode = () => {
    setVoiceMode(true)
    voice.resetToIdle()
  }

  const exitVoiceMode = () => {
    voice.stopAll()
    setVoiceMode(false)
  }

  const chatInput = (
    <ChatInput
      value={input}
      onChange={setInput}
      onSubmit={handleSubmit}
      disabled={streaming}
      hasMessages={true}
      onVoiceMode={enterVoiceMode}
      attachedImage={pendingImage}
      onImageAttach={(preview, data, mediaType) => setPendingImage({ preview, data, mediaType })}
      onImageRemove={() => setPendingImage(null)}
    />
  )

  const messageList = (
    <div className="flex-1 overflow-y-auto flex flex-col gap-6 pb-4">
      {messages.map((msg, i) => {
        const isStreamingThis = streaming && i === messages.length - 1 && msg.role === 'assistant'
        const displayContent = isStreamingThis ? filterStreamingContent(msg.content) : msg.content

        return (
          <div
            key={msg.id}
            className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                msg.role === 'user'
                  ? 'max-w-[75%] bg-muted border border-border rounded-2xl px-4 py-3 text-base'
                  : 'max-w-[75%] leading-relaxed'
              }
            >
              {msg.role === 'user' ? (
                <div>
                  {msg.imagePreview && (
                    <img
                      src={msg.imagePreview}
                      alt="Attached"
                      className="mb-2 max-h-48 rounded-lg object-cover"
                    />
                  )}
                  <p>{displayContent}</p>
                </div>
              ) : isStreamingThis && !displayContent ? (
                <GeneratingInline />
              ) : (
                <div className="markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
                </div>
              )}
              {msg.artifact && (
                <button
                  onClick={() => setActiveArtifact(resolveArtifact(msg.artifact!, messages))}
                  className="mt-2 w-full text-left rounded-xl border border-border px-4 py-3 text-sm hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <div className="text-xs text-muted-foreground mb-0.5">Artifact</div>
                  <div className="font-medium truncate">{msg.artifact.title}</div>
                </button>
              )}
            </div>
          </div>
        )
      })}
      <div ref={messagesEndRef} />
    </div>
  )

  const voicePanel = (
    <VoicePanel
      voiceState={voice.voiceState}
      onTap={voice.startListening}
      onInterrupt={voice.interrupt}
      onClose={exitVoiceMode}
    />
  )

  if (showRightPanel) {
    return (
      <div className="h-full bg-background text-foreground flex min-h-0">
        <div className="flex flex-col h-full min-h-0 px-6 pt-6 pb-6" style={{ width: '50%' }}>
          {voiceMode ? voicePanel : (
            <>
              {messageList}
              {chatInput}
            </>
          )}
        </div>
        <div className="w-px bg-border" />
        <div ref={rightPanelRef} className="flex-1 min-h-0">
          {activeArtifact
            ? <div key={activeArtifact.identifier} className="h-full p-6 animate-fade-in"><ArtifactPanel artifact={activeArtifact} /></div>
            : <GeneratingPanel key="generating" />
          }
        </div>
      </div>
    )
  }

  if (voiceMode) {
    return (
      <div className="h-full bg-background text-foreground flex flex-col min-h-0">
        {voicePanel}
      </div>
    )
  }

  return (
    <div className="h-full bg-background text-foreground flex flex-col min-h-0">
      <div className="flex flex-col flex-1 min-h-0 mx-auto w-full max-w-3xl px-6 pt-6 pb-6">
        {messageList}
        {chatInput}
      </div>
    </div>
  )
}
