import { useNavigate } from 'react-router-dom'
import { PanelLeft, PanelLeftClose, Sparkles } from 'lucide-react'
import { Tooltip } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'
import { useChatSessions } from '@/contexts/ChatSessionsContext'

interface Props {
  open: boolean
  onToggle: () => void
}

const tooltipPopupClass =
  'bg-popover text-popover-foreground text-xs px-2 py-1 rounded-md shadow-md border border-border'

function SidebarButton({
  icon,
  label,
  open,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  open: boolean
  tooltip: string
  onClick: () => void
}) {
  const button = (
    <button
      onClick={onClick}
      className="flex items-center w-full px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-150"
    >
      <span className="shrink-0">{icon}</span>
      <span
        className={cn(
          'ml-2 whitespace-nowrap overflow-hidden transition-all duration-500',
          open ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0'
        )}
      >
        {label}
      </span>
    </button>
  )

  if (open) return button

  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={button} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={8}>
          <Tooltip.Popup className={tooltipPopupClass}>{tooltip}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Sidebar({ open, onToggle }: Props) {
  const navigate = useNavigate()
  const { sessions } = useChatSessions()

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-sidebar border-r border-sidebar-border shrink-0 overflow-hidden',
        'transition-[width] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]',
        open ? 'w-56' : 'w-12'
      )}
    >
      <div className="flex flex-col gap-1 p-2">
        <SidebarButton
          icon={open ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
          label={open ? 'Close' : ''}
          open={open}
          tooltip="Open sidebar"
          onClick={onToggle}
        />
        <SidebarButton
          icon={<Sparkles size={18} />}
          label="New chat"
          open={open}
          tooltip="New chat"
          onClick={() => navigate('/')}
        />
      </div>

      {open && sessions.length > 0 && (
        <div className="flex flex-col min-h-0 mt-12">
          <div className="px-3 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Recents
          </div>
          <nav className="flex-1 overflow-y-auto px-2">
            {sessions.map(s => (
              <button
                key={s.id}
                onClick={() => navigate(`/chat/${s.id}`)}
                className="w-full text-left px-3 py-2 text-sm truncate rounded-md hover:bg-sidebar-accent transition-colors duration-150 text-sidebar-foreground"
              >
                {s.title}
              </button>
            ))}
          </nav>
        </div>
      )}
    </aside>
  )
}
