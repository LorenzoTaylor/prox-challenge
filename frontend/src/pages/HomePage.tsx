import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SilkBackground } from '@/components/SilkBackground'
import { BlurFade } from '@/components/ui/blur-fade'
import { SparkleIcon } from '@/components/SparkleIcon'
import { ChatInput } from '@/components/ChatInput'

export function HomePage() {
  const [input, setInput] = useState('')
  const navigate = useNavigate()

  function handleSubmit() {
    const trimmed = input.trim()
    if (!trimmed) return
    const chatId = crypto.randomUUID()
    navigate(`/chat/${chatId}`, { state: { initialMessage: trimmed } })
  }

  return (
    <div className="relative h-full bg-background text-foreground flex flex-col items-center justify-center px-6 overflow-hidden">
      <SilkBackground />
      <div className="relative z-10 flex flex-col items-center w-full">
        <BlurFade delay={0.1} direction="down" blur="12px">
          <div className="flex items-center gap-2 mb-10">
            <h1 className="text-6xl tracking-tight">Ask a <em>question</em></h1>
            <SparkleIcon className="w-12 h-12 shrink-0" delay={1} />
          </div>
        </BlurFade>
        <div className="w-full max-w-2xl">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            disabled={false}
            hasMessages={false}
          />
        </div>
      </div>
    </div>
  )
}
