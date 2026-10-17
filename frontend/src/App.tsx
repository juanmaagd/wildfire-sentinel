import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import Header from './components/Header'
import HotspotMap from './components/HotspotMap'
import Kpis from './components/Kpis'
import AlertsList from './components/AlertsList'
import DetailPanel from './components/DetailPanel'
import Feed from './components/Feed'
import SpreadView from './components/SpreadView'
import { urgencyOf } from './lib/format'
import { useRun } from './useRun'
import type { Focus, Site } from './types'

export default function App() {
  const { state, start, select, setLang, isMock } = useRun()
  const [fly, setFly] = useState<Focus | null>(null)
  const [bad, setBad] = useState<Set<string>>(() => new Set())
  const [spreadOpen, setSpreadOpen] = useState(false)
  const [kpisOpen, setKpisOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [feedOpen, setFeedOpen] = useState(false)
  const [toastId, setToastId] = useState<string | null>(null)

  // Replay start flies the 2D map to Ofunato.
  useEffect(() => {
    if (state.focus) setFly(state.focus)
  }, [state.focus])

  // Mock mode (?mock=1) replays the bundled events without the backend.
  useEffect(() => {
    if (!isMock) return
    const t = window.setTimeout(() => start('replay'), 600)
    return () => window.clearTimeout(t)
  }, [isMock, start])

  const sites = state.sites
  const alerts = useMemo(
    () =>
      Object.values(sites)
        .filter((s) => s.triage?.verdict === 'possible_fire')
        .sort((a, b) => urgencyOf(b) - urgencyOf(a) || (a.alertAt ?? 0) - (b.alertAt ?? 0)),
    [sites],
  )
  const selected: Site | undefined = state.selectedId ? sites[state.selectedId] : undefined

  // Show a one-line notice for each newly raised alert (newest by alert time), auto-hide after 8 s.
  const seen = useRef(0)
  useEffect(() => {
    if (alerts.length > seen.current) {
      const newest = [...alerts].sort((a, b) => (b.alertAt ?? 0) - (a.alertAt ?? 0))[0]
      if (newest) setToastId(newest.id)
    }
    seen.current = alerts.length
  }, [alerts])
  useEffect(() => {
    if (!toastId) return
    const t = window.setTimeout(() => setToastId(null), 8000)
    return () => window.clearTimeout(t)
  }, [toastId])
  const toast = toastId ? sites[toastId] : undefined

  const onBadImage = useCallback((u: string) => {
    setBad((prev) => (prev.has(u) ? prev : new Set(prev).add(u)))
  }, [])

  const pickFromList = (id: string) => {
    select(id)
    const h = sites[id]?.hotspot
    if (h) setFly({ lat: h.lat, lon: h.lon, zoom: 13, nonce: Date.now() })
  }

  const fuel = selected?.probe?.answers?.fuel_type as { value?: unknown } | undefined
  const fuelValue = typeof fuel?.value === 'string' ? fuel.value : undefined

  return (
    <div className="flex h-full flex-col">


      <main className="relative min-h-0 flex-1">
        {/* The map is the protagonist: full-bleed, everything else floats over it and can be collapsed. */}
        <HotspotMap sites={sites} selectedId={state.selectedId} fly={fly} onSelect={(id) => pickFromList(id)} />

        {/* Floating top-left column: product bar (no page header) + compact KPI strip. */}
        <div className="absolute left-4 top-4 flex flex-col items-start gap-2">
  <Header
          status={state.status}
          statusText={state.statusText}
          mode={state.mode}
          day={state.day}
          onStart={start}
          isMock={isMock}
        />
        <div className="bg-canvas/85 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setKpisOpen((v) => !v)}
            className="flex items-center gap-6 px-4 py-3 font-mono text-left"
            aria-expanded={kpisOpen}
          >
            <Stat label="Hotspots" value={state.stats.total} />
            <Stat label="Filtered" value={state.stats.industrial} />
            <Stat label="Alerts" value={alerts.length} accent />
            <ChevronDown className={`size-4 text-ash transition-transform ${kpisOpen ? 'rotate-180' : ''}`} />
          </button>
          {kpisOpen && (
            <div className="w-[520px] border-t border-iron p-4">
              <Kpis stats={state.stats} alerts={alerts.length} />
            </div>
          )}
        </div>
        </div>

        {/* Newest alert notice: one line over the map, click opens the detail drawer. */}
        {toast && !selected && (
          <button
            type="button"
            onClick={() => { pickFromList(toast.id); setToastId(null) }}
            className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 border border-lime bg-canvas/90 px-4 py-3 font-mono text-[13px] uppercase tracking-wider text-bone backdrop-blur-sm"
          >
            <span className="size-2 animate-pulse rounded-full bg-[#ff3b1f]" />
            <span className="text-lime">Alert</span>
            <span>possible fire · {toast.hotspot ? `${toast.hotspot.lat.toFixed(3)}, ${toast.hotspot.lon.toFixed(3)}` : ''}</span>
            <span className="text-ash">open →</span>
          </button>
        )}

        {/* Floating controls (top-right): alerts drawer + activity toggle. */}
        <div className="absolute right-4 top-4 flex gap-2">
          <button
            type="button"
            onClick={() => setAlertsOpen((v) => !v)}
            className={`rounded-[3.6px] border px-[14px] py-[10px] font-mono text-[13px] uppercase tracking-wider backdrop-blur-sm ${alertsOpen ? 'border-lime bg-canvas/90 text-lime' : 'border-iron bg-canvas/85 text-bone hover:border-bone'}`}
          >
            Alerts {alerts.length > 0 && <span className="ml-2 rounded-[3.6px] bg-lime px-[6px] text-canvas">{alerts.length}</span>}
          </button>
          <button
            type="button"
            onClick={() => setFeedOpen((v) => !v)}
            className={`rounded-[3.6px] border px-[14px] py-[10px] font-mono text-[13px] uppercase tracking-wider backdrop-blur-sm ${feedOpen ? 'border-lime bg-canvas/90 text-lime' : 'border-iron bg-canvas/85 text-bone hover:border-bone'}`}
          >
            Activity
          </button>
        </div>

        {/* Alerts drawer (right). */}
        {alertsOpen && !selected && (
          <aside className="absolute bottom-4 right-4 top-[72px] flex w-[420px] flex-col border border-iron bg-canvas/95 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-iron px-4 py-3 font-mono text-[13px] uppercase tracking-wider text-ash">
              <span>Alerts · {alerts.length}</span>
              <button type="button" onClick={() => setAlertsOpen(false)} aria-label="Close alerts"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AlertsList alerts={alerts} selectedId={state.selectedId} lang={state.lang} onSelect={pickFromList} />
            </div>
          </aside>
        )}

        {/* Detail drawer (right) — opens when an alert or marker is selected. */}
        {selected && (
          <aside className="absolute bottom-4 right-4 top-[72px] flex w-[520px] flex-col border border-iron bg-canvas/95 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-iron px-4 py-3 font-mono text-[13px] uppercase tracking-wider text-ash">
              <span>Site detail</span>
              <button type="button" onClick={() => select(null)} aria-label="Close detail"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DetailPanel
                site={selected}
                lang={state.lang}
                setLang={setLang}
                badImages={bad}
                onBadImage={onBadImage}
                onOpen3D={() => setSpreadOpen(true)}
              />
            </div>
          </aside>
        )}

        {/* Activity feed (bottom-left), collapsed by default. */}
        {feedOpen && (
          <div className="absolute bottom-12 left-4 h-56 w-[560px] border border-iron bg-canvas/95 backdrop-blur-sm">
            <Feed items={state.feed} />
          </div>
        )}

        {/* Legend (bottom-left), small. */}
        <div className="pointer-events-none absolute bottom-4 left-4 flex gap-4 bg-canvas/80 px-3 py-[6px] font-mono text-[12px] text-ash backdrop-blur-sm">
          <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[#ff3b1f]" />fire</span>
          <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-ash" />industrial</span>
          <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-iron" />water/other</span>
          <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full border border-lime" />memory</span>
        </div>
      </main>

      {spreadOpen && selected?.hotspot && (
        <SpreadView
          key={selected.id}
          lat={selected.hotspot.lat}
          lon={selected.hotspot.lon}
          day={selected.hotspot.acq_date}
          fuel={fuelValue}
          forceMock={isMock}
          onClose={() => setSpreadOpen(false)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <span className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wider text-ash">{label}</span>
      <span className={`text-[28px] font-light leading-none ${accent ? 'text-lime' : 'text-bone'}`}>{value}</span>
    </span>
  )
}
