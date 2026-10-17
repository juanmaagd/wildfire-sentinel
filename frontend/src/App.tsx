import { useCallback, useEffect, useMemo, useState } from 'react'
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

  const onBadImage = useCallback((u: string) => {
    setBad((prev) => (prev.has(u) ? prev : new Set(prev).add(u)))
  }, [])

  const pickFromList = (id: string) => {
    select(id)
    const h = sites[id]?.hotspot
    if (h) setFly({ lat: h.lat, lon: h.lon, zoom: 11, nonce: Date.now() })
  }

  const fuel = selected?.probe?.answers?.fuel_type as { value?: unknown } | undefined
  const fuelValue = typeof fuel?.value === 'string' ? fuel.value : undefined

  return (
    <div className="flex h-full flex-col">
      <Header
        status={state.status}
        statusText={state.statusText}
        mode={state.mode}
        day={state.day}
        onStart={start}
        isMock={isMock}
      />

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_460px]">
        <section className="flex min-h-0 flex-col">
          <div className="relative min-h-0 flex-1">
            <HotspotMap
              sites={sites}
              selectedId={state.selectedId}
              fly={fly}
              onSelect={(id) => select(id)}
            />
            <div className="pointer-events-none absolute left-4 top-4 bg-canvas/80 px-4 py-2 font-mono text-sm backdrop-blur-sm">
              <span className="mr-4 inline-flex items-center gap-2"><i className="size-3 rounded-full bg-[#ff3b1f]" />Possible fire</span>
              <span className="mr-4 inline-flex items-center gap-2"><i className="size-3 rounded-full bg-ash" />Industrial</span>
              <span className="mr-4 inline-flex items-center gap-2"><i className="size-3 rounded-full bg-iron" />Water / other</span>
              <span className="inline-flex items-center gap-2"><i className="size-3 rounded-full border-2 border-lime bg-ash" />Memory hit</span>
            </div>
          </div>
          <div className="h-48 shrink-0 border-t border-iron bg-canvas">
            <Feed items={state.feed} />
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-iron bg-transparent">
          <div className="shrink-0 p-4">
            <Kpis stats={state.stats} alerts={alerts.length} />
          </div>
          <div className="flex max-h-[34%] min-h-0 shrink-0 flex-col border-y border-iron">
            <div className="flex items-center justify-between px-4 py-2 font-mono text-[13px] uppercase tracking-wider text-ash">
              <span>Alerts</span>
              <span className="font-mono text-base text-lime">{alerts.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AlertsList alerts={alerts} selectedId={state.selectedId} lang={state.lang} onSelect={pickFromList} />
            </div>
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
