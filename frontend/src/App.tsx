import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import Header from './components/Header'
import HotspotMap from './components/HotspotMap'
import Kpis from './components/Kpis'
import AlertsList from './components/AlertsList'
import DetailPanel from './components/DetailPanel'
import Feed from './components/Feed'
import SpreadView from './components/SpreadView'
import FireGraphView from './components/FireGraphView'
import { buildIncidents, type Incident } from './lib/incidents'
import { urgencyOf } from './lib/format'
import type { VerdictFilter } from './components/HotspotMap'
import { useRun } from './useRun'
import type { Focus, Site } from './types'

export default function App() {
  const { state, start, select, setLang, ingest, paused, togglePause, isMock } = useRun()
  const [reportLoading, setReportLoading] = useState<string | null>(null)
  // Deep probe on demand: the run only analyses the strongest alert per batch automatically.
  const [probeState, setProbeState] = useState<Record<string, string>>({})
  const [fly, setFly] = useState<Focus | null>(null)
  const [bad, setBad] = useState<Set<string>>(() => new Set())
  const [spreadOpen, setSpreadOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [kpisOpen, setKpisOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [feedOpen, setFeedOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('urgency')
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
  // Detections within 2 km are one fire: the UI counts and lists incidents, not satellite pixels.
  const incidents = useMemo(() => buildIncidents(sites, state.day?.date), [sites, state.day?.date])
  const alerts = incidents
  const [filter, setFilter] = useState<VerdictFilter>('all')
  const selected: Site | undefined = state.selectedId ? sites[state.selectedId] : undefined

  // Show a one-line notice for each newly raised alert (newest by alert time), auto-hide after 8 s.
  const seen = useRef(0)
  useEffect(() => {
    if (alerts.length > seen.current) {
      const newest = alerts[alerts.length - 1]
      if (newest) setToastId(newest.rep.id)
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

  useEffect(() => {
    if (!selected || isMock || selected.probe || selected.triage?.verdict !== 'possible_fire' || probeState[selected.id]) return
    const id = selected.id
    setProbeState((s) => ({ ...s, [id]: 'loading' }))
    fetch(`/api/probe/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d) => {
        ingest('probe', d.probe)
        ingest('report', d.report)
        setProbeState((s) => ({ ...s, [id]: 'done' }))
      })
      .catch((err: Error) => setProbeState((s) => ({ ...s, [id]: `error: ${err.message}` })))
  }, [selected, isMock, probeState, ingest])

  // ai& report on demand: only for the alert a user opens.
  const requestReport = async (id: string) => {
    setReportLoading(id)
    try {
      const res = await fetch(`/api/report/${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      if (d.probe) ingest('probe', d.probe)
      ingest('report', d.report)
    } catch (err) {
      ingest('analysis_error', { id, message: `Report failed: ${(err as Error).message}` })
    } finally {
      setReportLoading(null)
    }
  }

  // 3D prediction for an incident starts from its first day, so the later real detections can be compared.
  // Live and drill have no satellite history: the prediction runs from now on the weather forecast.
  const replay = state.mode === 'replay'
  const spreadFrom = useMemo(() => {
    if (!selected?.hotspot) return undefined
    if (!replay) return { lat: selected.hotspot.lat, lon: selected.hotspot.lon, day: undefined }
    const inc = incidents.find((i) => i.sites.some((s) => s.id === selected.id))
    if (!inc) return { lat: selected.hotspot.lat, lon: selected.hotspot.lon, day: selected.hotspot.acq_date }
    const firstDay = inc.days[0]
    const first = [...inc.sites]
      .filter((s) => s.hotspot?.acq_date === firstDay)
      .sort((x, y) => (y.hotspot!.frp ?? 0) - (x.hotspot!.frp ?? 0))[0]
    return { lat: first.hotspot!.lat, lon: first.hotspot!.lon, day: firstDay }
  }, [selected, incidents, replay])

  const fuel = selected?.probe?.answers?.fuel_type as { value?: unknown } | undefined
  const fuelValue = typeof fuel?.value === 'string' ? fuel.value : undefined

  return (
    <div className="flex h-full flex-col">


      <main className="relative min-h-0 flex-1">
        {/* The map is the protagonist: full-bleed, everything else floats over it and can be collapsed. */}
        <HotspotMap sites={sites} incidents={incidents} filter={filter} selectedId={state.selectedId} fly={fly} onSelect={(id) => pickFromList(id)} onAnalyze={(b) => start('live', b)} busy={state.status === 'running'} />

        {/* Floating top-left column: product bar (no page header) + compact KPI strip. */}
        <div className="absolute left-4 top-4 flex flex-col items-start gap-2">
          <Header
            status={state.status}
            statusText={state.statusText}
            mode={state.mode}
            day={state.day}
            onStart={(m) => start(m)}
            isMock={isMock}
            paused={paused}
            onTogglePause={togglePause}
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
            <Stat label="Fires" value={alerts.length} accent />
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
            <span>new fire #{alerts.length} · {toast.hotspot ? `${toast.hotspot.lat.toFixed(3)}, ${toast.hotspot.lon.toFixed(3)}` : ''}</span>
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
            Fires {alerts.length > 0 && <span className="ml-2 rounded-[3.6px] bg-lime px-[6px] text-canvas">{alerts.length}</span>}
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
              <span>Fires · {alerts.length}</span>
              <button type="button" onClick={() => setAlertsOpen(false)} aria-label="Close alerts"><X className="size-4" /></button>
            </div>
            <div className="flex items-center gap-2 border-b border-iron px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-ash">
              <span>Sort</span>
              <div className="flex border border-iron" role="group" aria-label="Sort fires">
                {SORTS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={sortBy === k}
                    onClick={() => setSortBy(k)}
                    className={`px-2 py-[3px] ${sortBy === k ? 'bg-lime text-canvas' : 'text-bone hover:text-lime'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AlertsList incidents={sortIncidents(incidents, sortBy)} selectedId={state.selectedId} lang={state.lang} onSelect={pickFromList} />
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
                onOpenGraph={replay ? () => setGraphOpen(true) : undefined}
                onRequestReport={() => requestReport(selected.id)}
                reportLoading={reportLoading === selected.id}
                probeState={probeState[selected.id]}
                onRetryProbe={() => setProbeState(({ [selected.id]: _, ...rest }) => rest)}
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

        {/* Verdict filter + legend (bottom-left). */}
        <div className="absolute bottom-4 left-4 flex items-center gap-3 bg-canvas/85 px-2 py-[6px] font-mono text-[12px] uppercase tracking-wider backdrop-blur-sm">
          <div className="flex border border-iron" role="group" aria-label="Show">
            {([['all', 'All'], ['fires', 'Fires'], ['nonfire', 'Non-fire']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
                className={`px-3 py-[4px] ${filter === k ? 'bg-lime text-canvas' : 'text-bone hover:text-lime'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-2 text-ash"><i className="size-2 rounded-full bg-[#ff3b1f]" />fire</span>
          <span className="inline-flex items-center gap-2 text-ash"><i className="size-2 rounded-full bg-ash" />industrial</span>
          <span className="inline-flex items-center gap-2 text-ash"><i className="size-2 rounded-full bg-iron" />water/other</span>
          <span className="inline-flex items-center gap-2 text-ash"><i className="size-2 rounded-full border border-lime" />memory</span>
        </div>
      </main>

      {graphOpen && spreadFrom?.day && (
        <FireGraphView lat={spreadFrom.lat} lon={spreadFrom.lon} day={spreadFrom.day} name="Ofunato" onClose={() => setGraphOpen(false)} />
      )}

      {spreadOpen && spreadFrom && selected && (
        <SpreadView
          key={selected.id}
          lat={spreadFrom.lat}
          lon={spreadFrom.lon}
          day={spreadFrom.day}
          // Replay: the model was calibrated on the whole Ofunato incident with its default fuel; one site's photo
          // does not represent a 3,000 ha fire. Drill/live: the Jev fuel of the alerted site.
          fuel={replay ? undefined : fuelValue}
          siteId={selected.id}
          focus={selected.hotspot ? { lat: selected.hotspot.lat, lon: selected.hotspot.lon } : undefined}
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

type SortKey = 'urgency' | 'recent' | 'intensity' | 'size'
const SORTS: [SortKey, string][] = [['urgency', 'Urgency'], ['recent', 'Recent'], ['intensity', 'Intensity'], ['size', 'Size']]

// Fires drawer order. Urgency ties fall back to intensity; alerts still being analysed sort as urgency 0.
function sortIncidents(list: Incident[], by: SortKey): Incident[] {
  const key = (i: Incident): number[] =>
    by === 'urgency' ? [Math.max(...i.sites.map(urgencyOf)), i.maxFrp]
    : by === 'recent' ? [i.lastSeenMs]
    : by === 'intensity' ? [i.maxFrp]
    : [i.detections]
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b)
    for (let n = 0; n < ka.length; n++) if (kb[n] !== ka[n]) return kb[n] - ka[n]
    return 0
  })
}
