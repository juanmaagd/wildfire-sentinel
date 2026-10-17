import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef, useState } from 'react'
import { Map as MLMap, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import { Pause, Play, X } from 'lucide-react'
import { humanize } from '../lib/format'
import WeatherTimeline, { type HourWeather } from './WeatherTimeline'

export interface SpreadData {
  ignition: { lat: number; lon: number }
  wind: { from_deg: number; speed_ms: number; gust_ms: number }
  hours: number[]
  perimeters: FeatureCollection
  head_path: Feature
  stats: { area_ha: Record<string, number>; max_ros_m_min?: number; head_direction_deg: number }
  model?: string
  elapsed_ms?: number
  seeds?: FeatureCollection // burning points at t=0 (first satellite pass)
  observed?: FeatureCollection // what the satellite actually saw afterwards (properties.hours_after)
  observed_hits?: Record<string, [number, number]> // per horizon: [inside prediction, total]
  start?: string
  weather_hourly?: HourWeather[]
  rain_by_horizon?: Record<string, number>
}
export interface Tactic { name: string; when: string; where: string; resources: string; why: string }
export interface PlanData {
  at_hour: number
  lead_h: number
  plan_time: string | null
  burning_ha: number
  control_line: FeatureCollection
  with_plan: FeatureCollection
  area_ha: { no_action: Record<string, number>; with_plan: Record<string, number> }
  line_km: number
  line_type: string
  crews: { hand_crews: number; bulldozers: number }
  weather_next_12h: { max_gust_ms: number; wind_shift_deg: number; rain_mm: number; min_humidity_pct: number }
  brief: null | {
    objective_en: string
    objective_ja: string
    tactics: Tactic[]
    weather_watch: string
    crew_safety: string
    brief_ja: string
    latency_ms: number
  }
  brief_error?: string
}
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    photo: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 18,
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
    },
    dem: {
      type: 'raster-dem',
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    },
  },
  layers: [
    { id: 'sea', type: 'background', paint: { 'background-color': '#0b2a3a' } },
    { id: 'photo', type: 'raster', source: 'photo' },
  ],
}

const PERIM_COLOR = ['interpolate', ['linear'], ['get', 'hours'], 1, '#ffd000', 6, '#ffb000', 12, '#ff8a1f', 24, '#e0461f', 48, '#8b1010'] as const


interface Props {
  lat: number
  lon: number
  day?: string
  fuel?: string
  siteId?: string
  forceMock: boolean
  onClose: () => void
}

export default function SpreadView({ lat, lon, day, fuel, siteId, forceMock, onClose }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const readyRef = useRef(false)
  const [data, setData] = useState<SpreadData | null>(null)
  const steps = [0, ...(data?.hours ?? [1, 3, 6])]
  const [source, setSource] = useState<'api' | 'demo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hour, setHour] = useState(0) // continuous timeline position (hours after the prediction start)
  const [playing, setPlaying] = useState(false)
  const dataRef = useRef<SpreadData | null>(null)
  // Response plan: on demand, decided at the timeline hour the user is looking at.
  const [plans, setPlans] = useState<PlanData[]>([])
  const [active, setActive] = useState<number | null>(null)
  const plan = active !== null ? (plans[active] ?? null) : null
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [showPlan, setShowPlan] = useState(false)

  const requestPlan = async () => {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), at_hour: String(Math.floor(hour)) })
    if (day) q.set('day', day)
    if (fuel) q.set('fuel', fuel)
    if (siteId) q.set('id', siteId)
    setPlaying(false)
    setPlanLoading(true)
    setPlanError(null)
    try {
      const res = await fetch(`/api/plan?${q}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const next = (await res.json()) as PlanData
      // Keep earlier plans; a new plan at the same hour replaces the old one. Sorted by decision hour.
      const list = [...plans.filter((p) => p.at_hour !== next.at_hour), next].sort((a, b) => a.at_hour - b.at_hour)
      setPlans(list)
      setActive(list.indexOf(next))
      setShowPlan(true)
    } catch (err) {
      setPlanError((err as Error).message)
    } finally {
      setPlanLoading(false)
    }
  }

  // Fetch the prediction; fall back to the bundled demo model on any failure.
  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      setData(null)
      setError(null)
      if (!forceMock) {
        const q = new URLSearchParams({ lat: String(lat), lon: String(lon) })
        if (day) q.set('day', day)
        if (fuel) q.set('fuel', fuel)
        try {
          const res = await fetch(`/api/spread?${q}`, { signal: ac.signal })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = (await res.json()) as SpreadData
          if (ac.signal.aborted) return
          dataRef.current = json
          setSource('api')
          setData(json)
          return
        } catch (err) {
          if (ac.signal.aborted) return
          setError((err as Error).message)
        }
      }
      try {
        const res = await fetch('/mock-spread.json', { cache: 'no-store', signal: ac.signal })
        const json = (await res.json()) as SpreadData
        dataRef.current = json
        setSource('demo')
        setData(json)
      } catch {
        if (!ac.signal.aborted) setError('No spread data available')
      }
    })()
    return () => ac.abort()
  }, [lat, lon, day, fuel, forceMock])

  // Map lifecycle: created on open, destroyed on close.
  useEffect(() => {
    if (!el.current) return
    const map = new MLMap({
      container: el.current,
      style: STYLE,
      center: [lon, lat],
      zoom: 14,
      pitch: 65,
      bearing: 105,
      maxPitch: 85,
    })
    mapRef.current = map

    map.on('load', () => {
      map.setTerrain({ source: 'dem', exaggeration: 1.5 })
      map.addSource('perim', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('head', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('ign', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('seeds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('obs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('ctl', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'perim-fill', type: 'fill', source: 'perim', filter: ['<=', ['get', 'hours'], 0], paint: { 'fill-color': PERIM_COLOR as never, 'fill-opacity': 0.35 } })
      map.addLayer({ id: 'perim-line', type: 'line', source: 'perim', filter: ['<=', ['get', 'hours'], 0], paint: { 'line-color': PERIM_COLOR as never, 'line-width': 2.5 } })
      map.addLayer({ id: 'head-line', type: 'line', source: 'head', paint: { 'line-color': '#ffd000', 'line-width': 3 } })
      map.addLayer({ id: 'ign-pulse', type: 'circle', source: 'ign', paint: { 'circle-radius': 14, 'circle-color': '#ff3b1f', 'circle-opacity': 0.4 } })
      map.addLayer({ id: 'ign-dot', type: 'circle', source: 'ign', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#ff3b1f', 'circle-stroke-width': 3 } })
      // Prediction vs reality: burning at t=0 (orange) and later satellite detections (white) revealed with the timeline.
      map.addLayer({ id: 'seeds', type: 'circle', source: 'seeds', paint: { 'circle-radius': 4, 'circle-color': '#ff8a1f', 'circle-stroke-color': '#13140e', 'circle-stroke-width': 1 } })
      map.addLayer({ id: 'obs', type: 'circle', source: 'obs', filter: ['<=', ['get', 'hours_after'], -1], paint: { 'circle-radius': 5, 'circle-color': '#f4f3e8', 'circle-stroke-color': '#13140e', 'circle-stroke-width': 1.5 } })
      // Control line of the response plan (UI accent: it is an action, not fire data).
      // The line is a one-cell band: its contours are drawn as lines only (a fill would cover the whole interior).
      map.addLayer({ id: 'ctl-line', type: 'line', source: 'ctl', paint: { 'line-color': '#ebfc72', 'line-width': 3 } })
      readyRef.current = true
      applyData()
    })

    let raf = 0
    const pulse = () => {
      if (map.getLayer('ign-pulse')) {
        const k = 0.5 - 0.5 * Math.cos(((performance.now() % 1600) / 1600) * Math.PI * 2)
        map.setPaintProperty('ign-pulse', 'circle-radius', 8 + 18 * k)
        map.setPaintProperty('ign-pulse', 'circle-opacity', 0.5 - 0.4 * k)
      }
      raf = requestAnimationFrame(pulse)
    }
    raf = requestAnimationFrame(pulse)

    return () => {
      cancelAnimationFrame(raf)
      readyRef.current = false
      mapRef.current = null
      map.remove()
    }
    // The map is created once per open; data is applied through applyData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyData() {
    const m = mapRef.current
    const d = dataRef.current
    if (!m || !d || !readyRef.current) return
    ;(m.getSource('perim') as GeoJSONSource).setData(d.perimeters)
    ;(m.getSource('head') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [d.head_path] })
    ;(m.getSource('seeds') as GeoJSONSource).setData(d.seeds ?? { type: 'FeatureCollection', features: [] })
    ;(m.getSource('obs') as GeoJSONSource).setData(d.observed ?? { type: 'FeatureCollection', features: [] })
    ;(m.getSource('ign') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [d.ignition.lon, d.ignition.lat] } }],
    })
    // Camera: frame the whole predicted area (largest horizon) plus real detections, clear of the panels.
    const head = d.stats.head_direction_deg
    const coords: [number, number][] = [[d.ignition.lon, d.ignition.lat]]
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') coords.push([c[0] as number, c[1] as number])
      else if (Array.isArray(c)) c.forEach(walk)
    }
    const maxH = Math.max(...d.hours)
    for (const f of d.perimeters.features) if (f.properties?.hours === maxH) walk((f.geometry as { coordinates: unknown }).coordinates)
    for (const f of d.observed?.features ?? []) walk((f.geometry as { coordinates: unknown }).coordinates)
    const lons = coords.map((c) => c[0])
    const lats = coords.map((c) => c[1])
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
      padding: { top: 230, bottom: 400, left: 80, right: 80 },
      pitch: 55,
      bearing: head,
      duration: 0,
      maxZoom: 14.5,
    })
  }

  useEffect(() => {
    dataRef.current = data
    applyData()
    setHour(0)
  }, [data])

  // Swap the drawn perimeters between the unattended prediction and the one with the control line.
  useEffect(() => {
    const m = mapRef.current
    if (!m || !readyRef.current || !data) return
    const on = showPlan && plan
    ;(m.getSource('perim') as GeoJSONSource).setData(on ? plan.with_plan : data.perimeters)
    ;(m.getSource('ctl') as GeoJSONSource).setData(on ? plan.control_line : { type: 'FeatureCollection', features: [] })
  }, [showPlan, plan, data])

  useEffect(() => {
    const m = mapRef.current
    if (!m || !readyRef.current) return
    const filter = ['<=', ['get', 'hours'], hour]
    m.setFilter('perim-fill', filter as never)
    m.setFilter('perim-line', filter as never)
    m.setFilter('obs', ['<=', ['get', 'hours_after'], hour > 0 ? hour : -1] as never)
    // Burned more than 24 h ago = dark scar; the recent front stays bright.
    const recent = ['>', ['get', 'hours'], hour - 24]
    m.setPaintProperty('perim-fill', 'fill-color', ['case', recent, PERIM_COLOR, '#2a1410'] as never)
    m.setPaintProperty('perim-fill', 'fill-opacity', ['case', recent, 0.38, 0.6] as never)
    m.setPaintProperty('perim-line', 'line-color', ['case', recent, PERIM_COLOR, '#5a2a1c'] as never)
  }, [hour, data])

  // Timeline autoplay: sweep the hours (about 8 s for a week), then stop.
  const maxHour = data ? Math.max(...data.hours) : 0
  useEffect(() => {
    if (!playing) return
    if (hour >= maxHour) {
      setPlaying(false)
      return
    }
    const t = window.setTimeout(() => setHour((h) => Math.min(maxHour, h + 1)), 45)
    return () => window.clearTimeout(t)
  }, [playing, hour, maxHour])

  const step = steps.reduce((acc, h, i) => (h <= hour ? i : acc), 0)
  const hits = data?.observed_hits?.[String(steps[step])]
  const baseArea = data && step > 0 ? data.stats.area_ha[String(steps[step])] : 0
  const planArea = plan && step > 0 ? plan.area_ha.with_plan[String(steps[step])] : undefined
  const area = showPlan && planArea !== undefined ? planArea : baseArea
  const now = data?.weather_hourly?.[Math.min(Math.floor(hour), (data.weather_hourly?.length ?? 1) - 1)]
  const wind = data?.wind

  return (
    <div className="fixed inset-0 z-50 bg-canvas">
      <div className="absolute inset-0">
        <div ref={el} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-6">
        <div className="pointer-events-auto bg-canvas/80 backdrop-blur-sm px-5 py-4">
          <div className="font-sans font-normal text-[72px] leading-[0.95] tracking-[-0.03em] text-bone">Predicted spread</div>
          <div className="mt-1 font-mono text-[13px] uppercase tracking-wider text-ash">
            3D spread prediction{data?.start ? ` · from satellite pass ${data.start}` : ''}
          </div>
          {data?.observed && (
            <div className="mt-2 flex gap-4 font-mono text-[12px] uppercase tracking-wider text-ash">
              <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[#ff8a1f]" />burning at start</span>
              <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-bone" />real detections later</span>
            </div>
          )}
          {now ? (
            <div className="mt-3 font-mono text-[13px] uppercase tracking-wider tabular-nums text-bone">
              <span className="text-ash">{now.time.slice(5).replace('T', ' ')} JST · +{Math.floor(hour)}h · </span>
              wind {now.wind_speed_ms.toFixed(1)} m/s {compass(now.wind_from_deg)} · gusts {(now.wind_gust_ms ?? 0).toFixed(1)} · RH {Math.round(now.humidity_pct)}%
              {now.precip_mm >= 0.5 && <span className="ml-2 text-[#6cb6ff]">· raining {now.precip_mm.toFixed(1)} mm/h — spread stalls</span>}
            </div>
          ) : wind && (
            <div className="mt-3 font-mono text-[13px] uppercase tracking-wider tabular-nums text-lime">
              Wind {wind.speed_ms.toFixed(1)} m/s from {compass(wind.from_deg)} · gusts {wind.gust_ms.toFixed(1)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex items-center gap-2 border border-iron text-bone font-mono text-[13px] uppercase tracking-wider px-[14px] py-[10px] rounded-[3.6px] hover:border-bone"
        >
          <X size={18} /> Close
        </button>
      </div>

      {plan && showPlan && (
        <aside className="absolute bottom-6 right-6 top-[96px] flex w-[400px] flex-col bg-canvas/90 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3 border-b border-iron px-4 py-3 font-mono text-[12px] uppercase tracking-wider text-ash">
            <span>Plan P{(active ?? 0) + 1} · decided at +{plan.at_hour}h{plan.plan_time ? ` · ${plan.plan_time.slice(5).replace('T', ' ')} JST` : ''}</span>
            <button
              type="button"
              onClick={() => {
                setPlans((ps) => ps.filter((p) => p !== plan))
                setActive(null)
                setShowPlan(false)
              }}
              className="flex shrink-0 items-center gap-1 text-bone hover:text-lime"
              aria-label="Discard plan"
            >
              <X size={14} /> Discard
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
              <PlanStat label="Control line" value={`${plan.line_km} km`} />
              <PlanStat label="Hand crews" value={String(plan.crews.hand_crews)} />
              <PlanStat label="Bulldozers" value={String(plan.crews.bulldozers)} />
            </div>
            <div className="font-mono text-[12px] uppercase tracking-wider text-ash">
              {plan.line_type} · ready in {plan.lead_h}h · burning now {plan.burning_ha} ha
            </div>
            {plan.brief ? (
              <>
                <p className="text-[15px] leading-snug text-bone">{plan.brief.objective_en}</p>
                <p className="text-[13px] leading-snug text-ash">{plan.brief.objective_ja}</p>
                <ol className="space-y-3">
                  {plan.brief.tactics.map((t, i) => (
                    <li key={i} className="border-l-2 border-lime pl-3">
                      <div className="text-[14px] text-bone">{t.name}</div>
                      <div className="font-mono text-[11px] uppercase tracking-wider text-lime">{t.when}</div>
                      <div className="mt-1 text-[13px] leading-snug text-ash">{t.where}</div>
                      <div className="text-[13px] leading-snug text-ash">{t.resources}</div>
                      <div className="text-[13px] leading-snug text-bone/80">{t.why}</div>
                    </li>
                  ))}
                </ol>
                <PlanNote label="Weather watch" text={plan.brief.weather_watch} />
                <PlanNote label="Crew safety · LCES" text={plan.brief.crew_safety} />
                <PlanNote label="指揮官ブリーフ" text={plan.brief.brief_ja} />
                <div className="font-mono text-[11px] uppercase tracking-wider text-ash">Tactics by ai& · {plan.brief.latency_ms} ms</div>
              </>
            ) : (
              <div className="font-mono text-[12px] text-ash">Tactical brief unavailable ({plan.brief_error})</div>
            )}
          </div>
        </aside>
      )}

      {!data && (
        <div className="absolute inset-0 flex items-center justify-center bg-canvas/80">
          <div className="flex items-center gap-4 bg-canvas/80 backdrop-blur-sm px-8 py-6 font-mono text-[13px] uppercase tracking-wider text-bone">
            <span className="size-6 animate-spin rounded-[50%] border-2 border-iron border-t-lime" />
            {error ? 'Loading demo model…' : 'Simulating spread on terrain…'}
          </div>
        </div>
      )}

      {data && (
        <div className={`absolute inset-x-0 bottom-0 p-6 ${plan && showPlan ? 'pr-[448px]' : ''}`}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 bg-canvas/80 backdrop-blur-sm px-5 py-3">
            {data.weather_hourly && data.weather_hourly.length > 1 && (
              <div className="w-full">
                <WeatherTimeline
                  hourly={data.weather_hourly}
                  hour={hour}
                  marks={data.hours}
                  plans={plans.map((p, i) => ({ hour: p.at_hour, label: `P${i + 1}`, active: showPlan && i === active }))}
                  onPlan={(i) => {
                    setPlaying(false)
                    setActive(i)
                    setShowPlan(true)
                    setHour(plans[i].at_hour)
                  }}
                  onHour={(h) => {
                    setPlaying(false)
                    setHour(h)
                  }}
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                if (!playing && hour >= maxHour) setHour(0)
                setPlaying((p) => !p)
              }}
              className="flex size-10 items-center justify-center rounded-[3.6px] bg-lime text-canvas hover:bg-olive"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <div className="flex gap-2">
              {steps.map((h, i) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setPlaying(false)
                    setHour(h)
                  }}
                  className={`border font-mono text-[12px] uppercase tracking-wider tabular-nums px-[10px] py-[7px] rounded-[3.6px] ${
                    i === step ? 'border-lime text-lime' : 'border-iron text-bone hover:border-bone'
                  }`}
                >
                  {h === 0 ? 'Ignition' : `+${h}h`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestPlan}
                disabled={planLoading || forceMock}
                className="flex items-center gap-2 rounded-[3.6px] border border-lime px-[12px] py-[7px] font-mono text-[12px] uppercase tracking-wider text-lime hover:bg-lime hover:text-canvas disabled:opacity-50"
              >
                {planLoading && <span className="size-3 animate-spin rounded-[50%] border-2 border-iron border-t-lime" />}
                {planLoading ? 'Planning…' : `${plan ? 'Re-plan' : 'Plan response'} at +${Math.floor(hour)}h`}
              </button>
              {plan && (
                <div className="flex border border-iron" role="group" aria-label="Scenario">
                  {([[false, 'No action'], [true, 'With plan']] as const).map(([v, label]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={showPlan === v}
                      onClick={() => setShowPlan(v)}
                      className={`px-3 py-[7px] font-mono text-[12px] uppercase tracking-wider ${showPlan === v ? 'bg-lime text-canvas' : 'text-bone hover:text-lime'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {planError && <span className="font-mono text-[12px] text-ash">plan failed: {planError}</span>}
            </div>
            <div className="ml-auto text-right">
              <div className="font-mono font-light text-[40px] leading-none text-bone">
                {area ? area.toFixed(1) : '0.0'} <span className="font-mono text-lg text-ash">ha</span>
              </div>
              {showPlan && planArea !== undefined && baseArea > planArea && (
                <div className="font-mono text-[13px] uppercase tracking-wider text-lime">
                  vs {baseArea.toFixed(1)} ha with no action · −{Math.round(100 * (1 - planArea / baseArea))}%
                </div>
              )}
              {hits && hits[1] > 0 && (
                <div className="font-mono text-[13px] uppercase tracking-wider text-lime">
                  Satellite check · {hits[0]}/{hits[1]} real detections inside ({Math.round((100 * hits[0]) / hits[1])}%)
                </div>
              )}
              <div className="font-mono text-xs uppercase text-ash">
                {source === 'demo' ? 'Demo model' : data.model ? humanize(data.model) : 'Model output'}
                {data.elapsed_ms ? ` · ${Math.round(data.elapsed_ms)} ms` : ''}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ash">{label}</div>
      <div className="text-[22px] font-light leading-none text-bone">{value}</div>
    </div>
  )
}

function PlanNote({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-ash">{label}</div>
      <p className="mt-1 text-[13px] leading-snug text-bone/90">{text}</p>
    </div>
  )
}
