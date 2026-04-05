import { useState, useRef, useCallback } from 'react'
import type { AgentState } from '@/components/ui/orb'

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'talking'

export const ORB_AGENT_STATE: Record<VoiceState, AgentState> = {
  idle: null,
  listening: 'listening',
  thinking: 'thinking',
  talking: 'talking',
}

interface UseVoiceOptions {
  onTranscript: (text: string) => void
}

export function useVoice({ onTranscript }: UseVoiceOptions) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeRef = useRef(false)

  const startListening = useCallback(() => {
    const SR = (window as typeof window & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
      || (window as typeof window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition
    if (!SR) return

    activeRef.current = true
    const recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognitionRef.current = recognition

    recognition.onstart = () => setVoiceState('listening')

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript.trim()
      if (transcript) {
        setVoiceState('thinking')
        onTranscript(transcript)
      } else {
        setVoiceState('idle')
      }
    }

    recognition.onerror = () => {
      if (activeRef.current) setVoiceState('idle')
    }

    recognition.onend = () => {
      // Only reset to idle if we didn't get a result (result sets 'thinking')
      setVoiceState(prev => prev === 'listening' ? 'idle' : prev)
    }

    recognition.start()
  }, [onTranscript])

  const speak = useCallback(async (text: string) => {
    if (!activeRef.current) return
    setVoiceState('talking')

    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      if (!res.ok) throw new Error('TTS unavailable')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      audio.onended = () => {
        URL.revokeObjectURL(url)
        if (activeRef.current) setVoiceState('idle')
      }

      await audio.play()
    } catch {
      if (activeRef.current) setVoiceState('idle')
    }
  }, [])

  const stopAll = useCallback(() => {
    activeRef.current = false
    recognitionRef.current?.abort()
    recognitionRef.current = null
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setVoiceState('idle')
  }, [])

  const resetToIdle = useCallback(() => {
    activeRef.current = true
    setVoiceState('idle')
  }, [])

  // Interrupt: stop current audio/mic and return to idle (ready to listen again)
  const interrupt = useCallback(() => {
    recognitionRef.current?.abort()
    recognitionRef.current = null
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (activeRef.current) setVoiceState('idle')
  }, [])

  return { voiceState, startListening, speak, stopAll, resetToIdle, interrupt }
}
