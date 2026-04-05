import { useState, useRef, useEffect } from 'react'
import { Plus, ArrowUp, X } from 'lucide-react'
import { WaveformIcon } from '@/components/WaveformIcon'

interface AttachedImage {
  preview: string  // data URL
  data: string     // raw base64
  mediaType: string
}

interface Props {
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
  disabled: boolean
  hasMessages: boolean
  onVoiceMode?: () => void
  attachedImage?: AttachedImage | null
  onImageAttach?: (preview: string, data: string, mediaType: string) => void
  onImageRemove?: () => void
}

export function ChatInput({
  value, onChange, onSubmit, disabled, hasMessages,
  onVoiceMode, attachedImage, onImageAttach, onImageRemove,
}: Props) {
  const [micHovered, setMicHovered] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !onImageAttach) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      // Split "data:image/jpeg;base64,<data>" → extract media type and raw base64
      const [header, base64] = dataUrl.split(',')
      const mediaType = header.replace('data:', '').replace(';base64', '')
      onImageAttach(dataUrl, base64, mediaType)
    }
    reader.readAsDataURL(file)
    // Reset so the same file can be re-attached after removal
    e.target.value = ''
  }

  const canSubmit = !!value.trim() && !disabled

  return (
    <div className="rounded-2xl border border-gray-300 bg-white shadow-sm">

      {/* Image preview chip */}
      {attachedImage && (
        <div className="flex items-center gap-2 px-3 pt-3 pb-1">
          <div className="relative group w-fit">
            <img
              src={attachedImage.preview}
              alt="Attached"
              className="h-16 w-16 object-cover rounded-lg border border-border"
            />
            <button
              type="button"
              onClick={onImageRemove}
              aria-label="Remove image"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-3">

        {/* + button → opens file picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          aria-label="Attach image"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 p-1.5 rounded-md transition-colors duration-200 text-muted-foreground hover:bg-gray-100 cursor-pointer"
        >
          <Plus size={18} />
        </button>

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

        {/* Send / Mic button */}
        {!value && onVoiceMode ? (
          <button
            type="button"
            onClick={onVoiceMode}
            disabled={disabled}
            aria-label="Voice mode"
            onMouseEnter={() => setMicHovered(true)}
            onMouseLeave={() => setMicHovered(false)}
            className="shrink-0 p-1.5 rounded-md transition-all duration-200 bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-50 cursor-pointer"
          >
            <WaveformIcon size={16} animating={micHovered} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Send"
            className={`shrink-0 p-1.5 rounded-md transition-all duration-200 cursor-pointer ${
              canSubmit
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <ArrowUp size={16} />
          </button>
        )}

      </div>
    </div>
  )
}
