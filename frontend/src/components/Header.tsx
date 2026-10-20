import { HelpCircle, Pause, Play } from 'lucide-react'
import type { DayInfo, Mode, RunStatus } from '../types'

interface Props {
  status: RunStatus
  statusText: string
  mode: Mode | null
  day: DayInfo | null
  onStart: (m: Mode) => void
  isMock: boolean
  paused: boolean
  onTogglePause: () => void
  onHelp: () => void
}

const LABEL: Record<Mode, string> = { live: 'Live', drill: 'Drill · Ashikaga', replay: 'Replay · Ofunato' }

// Compact floating bar: brand · segmented mode control · short status.
export default function Header({ status, statusText, mode, day, onStart, isMock, paused, onTogglePause, onHelp }: Props) {
  const running = status === 'running'
  const short =
    status === 'error'
      ? 'error'
      : status === 'idle' || !mode
        ? 'ready'
        : `${day ? `day ${day.index}/${day.of} · ` : ''}${paused ? 'paused' : running ? 'live' : 'done'}`
  return (
    <header className="flex max-w-full items-center gap-3 whitespace-nowrap bg-canvas/85 py-2 pl-2 pr-3 backdrop-blur-sm sm:gap-4 sm:pr-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center bg-lime">
          <span className="size-2.5 bg-canvas" />
        </span>
        <span className="hidden text-[15px] font-normal tracking-[-0.03em] sm:inline">Wildfire Sentinel{isMock ? ' · mock' : ''}</span>
      </div>

      <nav className="flex border border-iron" aria-label="Mode">
        {(['replay'] as const).map((m) => {
          const active = mode === m && status !== 'idle'
          return (
            <button
              key={m}
              type="button"
              disabled={running}
              aria-pressed={active}
              onClick={() => onStart(m)}
              className={`px-3 py-[6px] font-mono text-[12px] uppercase tracking-wider disabled:opacity-40 ${
                active ? 'bg-lime text-canvas' : 'text-bone hover:text-lime'
              }`}
            >
              {LABEL[m]}
            </button>
          )
        })}
      </nav>

      {running && (
        <button
          type="button"
          onClick={onTogglePause}
          aria-label={paused ? 'Resume replay' : 'Pause replay'}
          className={`flex size-7 items-center justify-center rounded-[3.6px] border ${paused ? 'border-lime bg-lime text-canvas' : 'border-iron text-bone hover:border-lime hover:text-lime'}`}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      )}

      <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-wider text-ash" role="status" aria-live="polite" title={statusText}>
        <span className={`size-2 rounded-full ${running && !paused ? 'animate-pulse bg-lime' : paused ? 'bg-lime' : status === 'done' ? 'bg-lime/60' : 'bg-ash'}`} />
        {short}
      </div>

      <button type="button" onClick={onHelp} aria-label="How it works" title="How it works" className="text-ash hover:text-lime">
        <HelpCircle size={16} />
      </button>
    </header>
  )
}
