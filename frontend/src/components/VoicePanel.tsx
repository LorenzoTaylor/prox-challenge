import { useState } from 'react'
import { X, Square, Mic } from 'lucide-react'
import { Orb } from '@/components/ui/orb'
import { type VoiceState, ORB_AGENT_STATE } from '@/hooks/useVoice'

interface DockButtonProps {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}

function DockButton({ label, onClick, disabled, children }: DockButtonProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`p-2 rounded-lg transition-colors ${
          disabled
            ? 'text-muted-foreground/30 cursor-not-allowed'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer'
        }`}
      >
        {children}
      </button>
      {hovered && !disabled && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md bg-foreground text-background text-xs whitespace-nowrap pointer-events-none">
          {label}
        </div>
      )}
    </div>
  )
}

const STATUS: Record<VoiceState, string> = {
  idle: 'Tap to speak',
  listening: 'Listening...',
  thinking: 'Thinking...',
  talking: 'Speaking',
}

// Orb gradient colors — edit these two hex values to change the orb appearance.
// color[0] is the darker/cooler tone, color[1] is the lighter/warmer highlight.
// Current: deep amber + bright gold, matched to the design system primary token (#C4973B).
const ORB_COLORS: [string, string] = ['#c2c2c2', '#ffffff']

interface Props {
  voiceState: VoiceState
  onTap: () => void
  onInterrupt: () => void
  onClose: () => void
}

export function VoicePanel({ voiceState, onTap, onInterrupt, onClose }: Props) {
  const isIdle = voiceState === 'idle'
  const isThinking = voiceState === 'thinking'
  const canInterrupt = voiceState === 'listening' || voiceState === 'talking'

  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 px-8">

      {/* Orb */}
      <div
        className={`w-52 h-52 ${isIdle ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={isIdle ? onTap : undefined}
      >
        <Orb
          colors={ORB_COLORS}
          agentState={ORB_AGENT_STATE[voiceState]}
          seed={42}
        />
      </div>

      {/* Control dock */}
      <div className="w-fit rounded-full border border-border bg-background px-5 py-3 flex items-center justify-center gap-2">

        {/* Status text */}
        <span
          className="text-foreground mr-8"
          style={{ fontFamily: 'Instrument Serif, serif', fontSize: '1.1rem' }}
        >
          {STATUS[voiceState]}
        </span>

        {/* Vertical divider */}
        <div className="w-px h-5 bg-border shrink-0" />

        {/* Icon buttons */}
        <div className="flex items-center gap-1 shrink-0">

          <DockButton
            label="Interrupt"
            onClick={canInterrupt ? onInterrupt : undefined}
            disabled={!canInterrupt}
          >
            <Square size={15} />
          </DockButton>

          <DockButton
            label="Speak"
            onClick={isIdle ? onTap : undefined}
            disabled={!isIdle}
          >
            <Mic size={15} />
          </DockButton>

          <DockButton
            label="Exit"
            onClick={!isThinking ? onClose : undefined}
            disabled={isThinking}
          >
            <X size={15} />
          </DockButton>

        </div>
      </div>

    </div>
  )
}
