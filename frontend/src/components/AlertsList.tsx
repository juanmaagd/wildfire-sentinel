import { siteCoord, urgencyOf } from '../lib/format'
import type { Lang, Site } from '../types'

// Urgency is shown as lime fill or outline, not red: the accent carries severity.
const URGENCY_BG = ['', 'border border-iron text-ash', 'border border-iron text-ash', 'border border-lime text-lime', 'bg-lime text-canvas', 'bg-lime text-canvas']

interface Props {
  alerts: Site[]
  selectedId: string | null
  lang: Lang
  onSelect: (id: string) => void
}

export default function AlertsList({ alerts, selectedId, lang, onSelect }: Props) {
  if (!alerts.length) return <p className="px-4 py-6 text-base text-ash">No alerts yet.</p>
  return (
    <ul role="listbox" aria-label="Alerts" className="divide-y divide-iron">
      {alerts.map((s) => {
        const u = urgencyOf(s)
        const r = s.report
        const title = r ? (lang === 'ja' ? r.headline_ja : r.headline_en) || r.headline_en || 'Possible fire' : 'Possible fire'
        const step = r ? `urgency ${u}/5` : s.probe ? 'writing report…' : 'probing…'
        const sel = s.id === selectedId
        return (
          <li key={s.id}>
            <button
              type="button"
              role="option"
              aria-selected={sel}
              onClick={() => onSelect(s.id)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-iron/40 ${sel ? 'border-l-2 border-lime bg-bone/5' : 'border-l-2 border-transparent'}`}
            >
              {u ? (
                <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[3.6px] font-mono text-lg font-light ${URGENCY_BG[u]}`} title={`Urgency ${u} of 5`}>
                  {u}
                </span>
              ) : (
                <span className="mt-0.5 flex h-9 shrink-0 items-center rounded-[3.6px] bg-iron px-2 font-mono text-xs text-ash">NEW</span>
              )}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-lg font-normal ${r && lang === 'ja' ? 'font-jp' : ''}`}>{title}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-sm text-ash">
                  <span>{siteCoord(s)}</span>
                  {s.hotspot?.frp != null && <span>FRP {s.hotspot.frp.toFixed(1)} MW</span>}
                  <span>{step}</span>
                  {s.triage?.source === 'memory' && <span className="text-lime">memory</span>}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
