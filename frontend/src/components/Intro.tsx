import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'

interface Props {
  onClose: () => void
  onReplay: () => void
}

interface Step {
  label: string
  title: string
  body: string[]
}

const STEPS: Step[] = [
  {
    label: 'What it is',
    title: 'Every fire on Earth, triaged in seconds',
    body: [
      'NASA satellites flag thousands of hot spots every day. Most are factories, volcanoes or farm burns.',
      'Wildfire Sentinel finds the real wildfires, rates how dangerous they are and predicts where they go next.',
    ],
  },
  {
    label: 'Satellites',
    title: 'Satellites see the heat',
    body: [
      'Three VIIRS satellites (NOAA-20, NOAA-21, Suomi NPP) pass over every few hours and report hot pixels about 375 m wide.',
      'Their detections are merged, so the same fire seen twice counts once.',
    ],
  },
  {
    label: 'AI triage',
    title: 'An AI looks at every hotspot',
    body: [
      'Jev checks an aerial photo of each spot and filters out industry. Real fires get a closer look: fuel, homes and roads nearby.',
      'Danger and urgency (1–5) come from fixed rules plus live weather, never from the AI. ai& writes the situation report and Neo4j remembers every site.',
    ],
  },
  {
    label: 'Prediction',
    title: 'Where the fire goes next',
    body: [
      'The 3D view simulates the next 48 hours from hourly wind, slope, fuel moisture and land cover.',
      'Calibrated on 18 real fires, it covers 67% of later satellite detections on fires it was never tuned on. A response plan shows where a control line would stop it.',
    ],
  },
  {
    label: 'How to use it',
    title: 'Start exploring',
    body: [
      'Pan the map anywhere and press Search this area to scan it with live satellite data.',
      'Open a fire from the Fires panel to read its report, then press 3D spread prediction.',
      'Or watch Replay · Ofunato: the 2025 Ofunato fire in Japan, day by day.',
    ],
  },
]

// First-visit walkthrough (the app has no landing page). Arrows / Esc on the keyboard.
export default function Intro({ onClose, onReplay }: Props) {
  const [i, setI] = useState(0)
  const last = i === STEPS.length - 1
  const step = STEPS[i]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((v) => Math.min(v + 1, STEPS.length - 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(v - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ghost = 'flex items-center gap-2 rounded-[3.6px] border border-iron px-[14px] py-[10px] font-mono text-[13px] uppercase tracking-wider text-bone hover:border-bone disabled:opacity-30 disabled:hover:border-iron'
  const primary = 'flex items-center gap-2 rounded-[3.6px] bg-lime px-[18px] py-[12px] font-mono text-[13px] uppercase tracking-wider text-canvas hover:bg-olive'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-title"
        className="relative flex w-full max-w-[560px] flex-col border border-iron bg-canvas"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-iron px-6 py-4">
          <span className="font-mono text-[13px] uppercase tracking-wider text-ash">
            <span className="text-lime">{String(i + 1).padStart(2, '0')}</span> / {String(STEPS.length).padStart(2, '0')} · {step.label}
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ash hover:text-bone">
            <X size={18} />
          </button>
        </header>

        <div className="flex min-h-[300px] flex-col gap-5 px-6 py-8">
          <h2 id="intro-title" className="text-[32px] font-normal leading-[1] tracking-[-0.03em] text-bone sm:text-[40px] sm:leading-[0.95]">
            {step.title}
          </h2>
          <div className="flex flex-col gap-3 text-[16px] leading-[1.6] text-bone">
            {step.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>

        <div className="flex gap-1 px-6" aria-hidden>
          {STEPS.map((s, k) => (
            <button key={s.label} type="button" tabIndex={-1} onClick={() => setI(k)} className={`h-[3px] flex-1 ${k <= i ? 'bg-lime' : 'bg-iron'}`} />
          ))}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
          <button type="button" onClick={() => setI(i - 1)} disabled={i === 0} className={ghost}>
            <ArrowLeft size={14} /> Back
          </button>
          {last ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onClose} className={ghost}>Explore the map</button>
              <button type="button" onClick={onReplay} className={primary}>Watch the replay</button>
            </div>
          ) : (
            <button type="button" onClick={() => setI(i + 1)} className={primary}>
              Next <ArrowRight size={14} />
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  )
}
