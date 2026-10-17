import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef, useState } from 'react'
import { Map as MLMap, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import { Pause, Play, X } from 'lucide-react'
import { humanize } from '../lib/format'

export interface SpreadData {
  ignition: { lat: number; lon: number }
  wind: { from_deg: number; speed_ms: number; gust_ms: number }
  hours: number[]
  perimeters: FeatureCollection
  head_path: Feature
  stats: { area_ha: Record<string, number>; max_ros_m_min?: number; head_direction_deg: number }
  model?: string
  elapsed_ms?: number
}

const STEPS = [0, 1, 3, 6]
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

const PERIM_COLOR = ['match', ['get', 'hours'], 1, '#ffd000', 3, '#ff8a1f', 6, '#b71c1c', '#ffd000'] as const

// Offset a point by km along a compass bearing.
function offset(lat: number, lon: number, bearingDeg: number, km: number): [number, number] {
  const r = (bearingDeg * Math.PI) / 180
  const dLat = (Math.cos(r) * km) / 111.32
  const dLon = (Math.sin(r) * km) / (111.32 * Math.cos((lat * Math.PI) / 180))
  return [lon + dLon, lat + dLat]
}

interface Props {
  lat: number
  lon: number
  day?: string
  fuel?: string
  forceMock: boolean
  onClose: () => void
}

export default function SpreadView({ lat, lon, day, fuel, forceMock, onClose }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const readyRef = useRef(false)
  const [data, setData] = useState<SpreadData | null>(null)
  const [source, setSource] = useState<'api' | 'demo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const dataRef = useRef<SpreadData | null>(null)

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
      map.addLayer({ id: 'perim-fill', type: 'fill', source: 'perim', filter: ['<=', ['get', 'hours'], 0], paint: { 'fill-color': PERIM_COLOR as never, 'fill-opacity': 0.35 } })
      map.addLayer({ id: 'perim-line', type: 'line', source: 'perim', filter: ['<=', ['get', 'hours'], 0], paint: { 'line-color': PERIM_COLOR as never, 'line-width': 2.5 } })
      map.addLayer({ id: 'head-line', type: 'line', source: 'head', paint: { 'line-color': '#ffd000', 'line-width': 3 } })
      map.addLayer({ id: 'ign-pulse', type: 'circle', source: 'ign', paint: { 'circle-radius': 14, 'circle-color': '#ff3b1f', 'circle-opacity': 0.4 } })
      map.addLayer({ id: 'ign-dot', type: 'circle', source: 'ign', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#ff3b1f', 'circle-stroke-width': 3 } })
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
    ;(m.getSource('ign') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [d.ignition.lon, d.ignition.lat] } }],
    })
    // Camera: behind the ignition, looking along the head direction.
    const head = d.stats.head_direction_deg
    const [cLon, cLat] = offset(d.ignition.lat, d.ignition.lon, head, 1.2)
    m.jumpTo({ center: [cLon, cLat], zoom: 14, pitch: 65, bearing: head })
  }

  useEffect(() => {
    dataRef.current = data
    applyData()
    setStep(0)
  }, [data])

  useEffect(() => {
    const m = mapRef.current
    if (!m || !readyRef.current) return
    const filter = ['<=', ['get', 'hours'], STEPS[step]]
    m.setFilter('perim-fill', filter as never)
    m.setFilter('perim-line', filter as never)
  }, [step, data])

  // Timeline autoplay: advance through the steps, then stop.
  useEffect(() => {
    if (!playing) return
    if (step >= STEPS.length - 1) {
      setPlaying(false)
      return
    }
    const t = window.setTimeout(() => setStep((s) => s + 1), 1400)
    return () => window.clearTimeout(t)
  }, [playing, step])

  const area = data && step > 0 ? data.stats.area_ha[String(STEPS[step])] : 0
  const wind = data?.wind

  return (
    <div className="fixed inset-0 z-50 bg-canvas">
      <div className="absolute inset-0">
        <div ref={el} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-6">
        <div className="pointer-events-auto bg-canvas/80 backdrop-blur-sm px-5 py-4">
          <div className="font-sans font-normal text-[72px] leading-[0.95] tracking-[-0.03em] text-bone">Predicted spread</div>
          <div className="mt-1 font-mono text-[13px] uppercase tracking-wider text-ash">3D spread prediction</div>
          {wind && (
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

      {!data && (
        <div className="absolute inset-0 flex items-center justify-center bg-canvas/80">
          <div className="flex items-center gap-4 bg-canvas/80 backdrop-blur-sm px-8 py-6 font-mono text-[13px] uppercase tracking-wider text-bone">
            <span className="size-6 animate-spin rounded-[50%] border-2 border-iron border-t-lime" />
            {error ? 'Loading demo model…' : 'Simulating spread on terrain…'}
          </div>
        </div>
      )}

      {data && (
        <div className="absolute inset-x-0 bottom-0 p-6">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 bg-canvas/80 backdrop-blur-sm px-5 py-4">
            <button
              type="button"
              onClick={() => {
                if (!playing && step >= STEPS.length - 1) setStep(0)
                setPlaying((p) => !p)
              }}
              className="flex size-12 items-center justify-center rounded-[3.6px] bg-lime text-canvas hover:bg-olive"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <div className="flex gap-2">
              {STEPS.map((h, i) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setPlaying(false)
                    setStep(i)
                  }}
                  className={`border font-mono text-[13px] uppercase tracking-wider tabular-nums px-[14px] py-[10px] rounded-[3.6px] ${
                    i === step ? 'border-lime text-lime' : 'border-iron text-bone hover:border-bone'
                  }`}
                >
                  {h === 0 ? 'Ignition' : `+${h}h`}
                </button>
              ))}
            </div>
            <div className="ml-auto text-right">
              <div className="font-mono font-light text-[56px] text-bone">
                {area ? area.toFixed(1) : '0.0'} <span className="font-mono text-lg text-ash">ha</span>
              </div>
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
