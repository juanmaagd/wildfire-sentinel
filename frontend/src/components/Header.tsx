import { Radio, History } from 'lucide-react'
import type { DayInfo, Mode, RunStatus } from '../types'

interface Props {
  status: RunStatus
  statusText: string
  mode: Mode | null
  day: DayInfo | null
  onStart: (m: Mode) => void
  isMock: boolean
}

const LABEL: Record<Mode, string> = { live: 'Live · today', replay: 'Replay · Ofunato 2025' }

export default function Header({ status, statusText, mode, day, onStart, isMock }: Props) {
  const running = status === 'running'
  const text =
    status === 'error'
      ? statusText
      : mode && status !== 'idle'
        ? `${LABEL[mode]}${day ? ` — day ${day.index}/${day.of} · ${day.date}` : ''}${running ? ' · streaming' : status === 'done' ? ' · complete' : ''}`
        : 'Ready'
  const tone =
    status === 'running' ? 'bg-lime animate-pulse' : status === 'error' ? 'bg-lime' : status === 'done' ? 'bg-lime/50' : 'bg-ash'
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-iron bg-canvas px-6">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center bg-lime">
          <span className="size-3 bg-canvas" />
        </div>
        <div className="leading-tight">
          <div className="text-xl font-normal tracking-tight">Wildfire Sentinel</div>
          <div className="font-mono text-xs uppercase tracking-[0.12em] text-ash">
            Disaster operations console{isMock ? ' · mock' : ''}
          </div>
        </div>
      </div>

      <nav className="ml-4 flex gap-2" aria-label="Mode">
        {(['live', 'replay'] as const).map((m) => {
          const Icon = m === 'live' ? Radio : History
          const active = mode === m && status !== 'idle'
          return (
            <button
              key={m}
              type="button"
              disabled={running}
              aria-pressed={active}
              onClick={() => onStart(m)}
              className={`flex items-center gap-2 rounded-[3.6px] border px-[14px] py-[10px] font-mono text-[13px] uppercase tracking-wider transition disabled:opacity-40 ${
                active ? 'border-lime text-lime' : 'border-iron text-bone hover:border-bone'
              }`}
            >
              <Icon size={18} />
              {LABEL[m]}
            </button>
          )
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3 font-mono text-sm" role="status" aria-live="polite">
        <span className={`size-2.5 rounded-[3.6px] ${tone}`} />
        <span className="text-bone">{text}</span>
      </div>
    </header>
  )
}
