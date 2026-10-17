import type { DayInfo, Mode, RunStatus } from '../types'

interface Props {
  status: RunStatus
  statusText: string
  mode: Mode | null
  day: DayInfo | null
  onStart: (m: Mode) => void
  isMock: boolean
}

const LABEL: Record<Mode, string> = { live: 'Live', replay: 'Replay · Ofunato' }

// Compact floating bar: brand · segmented mode control · short status.
export default function Header({ status, statusText, mode, day, onStart, isMock }: Props) {
  const running = status === 'running'
  const short =
    status === 'error'
      ? 'error'
      : status === 'idle' || !mode
        ? 'ready'
        : `${day ? `day ${day.index}/${day.of} · ` : ''}${running ? 'live' : 'done'}`
  return (
    <header className="flex items-center gap-4 bg-canvas/85 py-2 pl-2 pr-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center bg-lime">
          <span className="size-2.5 bg-canvas" />
        </span>
        <span className="text-[15px] font-normal tracking-[-0.03em]">Wildfire Sentinel{isMock ? ' · mock' : ''}</span>
      </div>

      <nav className="flex border border-iron" aria-label="Mode">
        {(['live', 'replay'] as const).map((m) => {
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

      <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-wider text-ash" role="status" aria-live="polite" title={statusText}>
        <span className={`size-2 rounded-full ${running ? 'animate-pulse bg-lime' : status === 'done' ? 'bg-lime/60' : 'bg-ash'}`} />
        {short}
      </div>
    </header>
  )
}
