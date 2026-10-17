import { urgencyOf } from '../lib/format'
import type { Incident } from '../lib/incidents'
import type { Lang } from '../types'

// Urgency is shown as lime fill or outline, not red: the accent carries severity.
const URGENCY_BG = ['', 'border border-iron text-ash', 'border border-iron text-ash', 'border border-lime text-lime', 'bg-lime text-canvas', 'bg-lime text-canvas']

interface Props {
  incidents: Incident[]
  selectedId: string | null
  lang: Lang
  onSelect: (id: string) => void
}

// One row per fire incident (grouped detections), not per satellite pixel.
export default function AlertsList({ incidents, selectedId, lang, onSelect }: Props) {
  if (!incidents.length) return <p className="px-4 py-6 text-base text-ash">No fires detected.</p>
  return (
    <ul role="listbox" aria-label="Fire incidents" className="divide-y divide-iron">
      {incidents.map((inc) => {
        const s = inc.rep
        const u = urgencyOf(s)
        const r = s.report && !s.report.brief_pending ? s.report : undefined
        const title = (r && ((lang === 'ja' ? r.headline_ja : r.headline_en) || r.headline_en)) || `Fire #${inc.n}`
        const sel = inc.sites.some((x) => x.id === selectedId)
        const days = inc.days.length > 1 ? `${inc.days.length} days` : inc.days[0] ?? ''
        return (
          <li key={inc.id}>
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
                <span className="mt-0.5 flex h-7 shrink-0 items-center rounded-[3.6px] bg-iron px-2 font-mono text-xs text-ash">NEW</span>
              )}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-lg font-normal ${r && lang === 'ja' ? 'font-jp' : ''}`}>{title}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-sm text-ash">
                  <span>{inc.center[1].toFixed(3)}, {inc.center[0].toFixed(3)}</span>
                  <span>{inc.detections} detections</span>
                  {days && <span>{days}</span>}
                  <span>max {inc.maxFrp.toFixed(1)} MW</span>
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
