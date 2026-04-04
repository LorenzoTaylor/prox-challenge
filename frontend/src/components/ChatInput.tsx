import { useState, useRef, useEffect } from 'react'
import { Plus, ArrowUp } from 'lucide-react'

interface Props {
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
  disabled: boolean
  hasMessages: boolean
}

export function ChatInput({ value, onChange, onSubmit, disabled, hasMessages }: Props) {
  const [plusHovered, setPlusHovered] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`
  }, [value])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  const canSubmit = !!value.trim() && !disabled

  return (
    <div className="rounded-2xl border border-gray-300 bg-white shadow-sm">
      <div className="flex items-end gap-2 px-3 py-3">

        {/* + button with hover bg animation and popover */}
        <div
          className="relative shrink-0"
          onMouseEnter={() => setPlusHovered(true)}
          onMouseLeave={() => setPlusHovered(false)}
        >
          <button
            type="button"
            aria-label="Add files"
            className={`p-1.5 rounded-md transition-all duration-200 text-muted-foreground ${
              plusHovered ? 'bg-gray-100' : 'bg-transparent'
            }`}
          >
            <Plus size={18} />
          </button>

          {/* Hover popover */}
          <div
            className={`absolute bottom-full left-0 mb-2 bg-white border border-border rounded-md shadow-md px-3 py-2 text-sm text-foreground whitespace-nowrap transition-all duration-150 ${
              plusHovered
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-1 pointer-events-none'
            }`}
          >
            Add files
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={hasMessages ? 'Reply...' : 'Ask a question...'}
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-sm leading-6 max-h-48 overflow-y-auto py-1 placeholder:text-muted-foreground disabled:opacity-50"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label="Send"
          className={`shrink-0 p-1.5 rounded-md transition-all duration-200 ${
            canSubmit
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          <ArrowUp size={16} />
        </button>

      </div>
    </div>
  )
}
