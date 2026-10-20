import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef, useState } from 'react'
import { LocateFixed, Search } from 'lucide-react'
import { Map as MLMap, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import type { Focus, Site } from '../types'
import type { Incident } from '../lib/incidents'

export type VerdictFilter = 'all' | 'fires' | 'nonfire'

// OpenFreeMap "dark" (OpenStreetMap vector tiles, no key, local-language labels): the same detailed basemap in
// every country. GSI's pale map only exists for Japan, and darkened imagery elsewhere read as "not loaded".
const BASE = 'https://tiles.openfreemap.org/styles/dark'

const USA: [[number, number], [number, number]] = [[-125, 24], [-66, 50]] // default view when location is unavailable
const MAX_SPAN_DEG = 30 // a country or region; the server rejects wider searches
const LOCAL_ZOOM = 8 // ~150 km across: a region small enough that every hotspot in it gets analysed
const EMPTY = { type: 'FeatureCollection' as const, features: [] as Feature[] }

export function toGeoJSON(sites: Record<string, Site>): FeatureCollection {
  const features: Feature[] = []
  const dates = Object.values(sites).map((s) => s.hotspot?.acq_date).filter(Boolean) as string[]
  const latest = dates.length ? Date.parse([...dates].sort().at(-1)!) : 0
  for (const s of Object.values(sites)) {
    const h = s.hotspot
    if (!h) continue
    features.push({
      type: 'Feature',
      properties: {
        id: s.id,
        verdict: s.triage?.verdict ?? 'pending',
        memory: s.triage?.source === 'memory' ? 1 : 0,
        age: h.acq_date && latest ? Math.round((latest - Date.parse(h.acq_date)) / 86400000) : 0,
      },
      geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

interface Props {
  sites: Record<string, Site>
  incidents: Incident[]
  filter: VerdictFilter
  selectedId: string | null
  fly: Focus | null
  onSelect: (id: string) => void
  onAnalyze: (bbox: string) => void // "west,south,east,north" of the current view
  busy: boolean // a run is in progress: hide "Search this area"
  scanRequest?: number // bump to search the current view (walkthrough CTA)
}

const incidentGeo = (incidents: Incident[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: incidents.map((i) => ({ ...i.outline, properties: { rep: i.rep.id, n: i.n, active: i.active ? 1 : 0 } })),
})
const incidentCenters = (incidents: Incident[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: incidents.filter((i) => i.active).map((i) => ({ type: 'Feature', properties: { rep: i.rep.id }, geometry: { type: 'Point', coordinates: i.center } })),
})
const DOT_FILTER = {
  all: null,
  fires: ['==', ['get', 'verdict'], 'possible_fire'],
  nonfire: ['!=', ['get', 'verdict'], 'possible_fire'],
} as const

export default function HotspotMap({ sites, incidents, filter, selectedId, fly, onSelect, onAnalyze, busy, scanRequest = 0 }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const loaded = useRef(false)
  const geo = toGeoJSON(sites)
  const geoRef = useRef(geo)
  geoRef.current = geo
  const incRef = useRef(incidents)
  incRef.current = incidents
  const filterRef = useRef(filter)
  filterRef.current = filter
  const selRef = useRef(selectedId)
  selRef.current = selectedId
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  // Moving the map never fetches hotspots: it only offers "Search this area", like a maps app.
  const [moved, setMoved] = useState(true) // offered on first load too (location denied keeps the default view)
  const [locating, setLocating] = useState(false)
  const [tooWide, setTooWide] = useState(false)

  const pushData = () => {
    const m = mapRef.current
    if (!m || !loaded.current) return
    ;(m.getSource('hot') as GeoJSONSource | undefined)?.setData(geoRef.current)
    ;(m.getSource('inc') as GeoJSONSource | undefined)?.setData(incidentGeo(incRef.current))
    ;(m.getSource('inc-c') as GeoJSONSource | undefined)?.setData(incidentCenters(incRef.current))
    m.setFilter('hot-selected', ['==', ['get', 'id'], selRef.current ?? ''])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.setFilter('hot-dots', DOT_FILTER[filterRef.current] as any)
    const showFires = filterRef.current !== 'nonfire' ? 'visible' : 'none'
    for (const l of ['inc-fill', 'inc-line', 'fire-halo']) m.setLayoutProperty(l, 'visibility', showFires)
  }

  useEffect(() => {
    if (!el.current) return
    const map = new MLMap({
      container: el.current,
      style: BASE,
      bounds: USA,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
    })
    mapRef.current = map

    const checkSpan = () => {
      const b = map.getBounds()
      setTooWide(b.getEast() - b.getWest() > MAX_SPAN_DEG || b.getNorth() - b.getSouth() > MAX_SPAN_DEG)
    }
    map.on('moveend', () => {
      setMoved(true)
      checkSpan()
    })

    map.on('load', () => {
      checkSpan()
      // Compact attribution starts expanded and covers the bottom controls on phones; keep it behind its (i).
      el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      locate(map)
      map.addSource('hot', { type: 'geojson', data: EMPTY })
      map.addSource('inc', { type: 'geojson', data: EMPTY })
      map.addSource('inc-c', { type: 'geojson', data: EMPTY })
      // One fire incident = one translucent area + one pulse, instead of dozens of red dots.
      // Extinguished incidents turn into a grey burn scar; only active ones pulse.
      map.addLayer({ id: 'inc-fill', type: 'fill', source: 'inc', paint: { 'fill-color': ['case', ['==', ['get', 'active'], 1], '#ff3b1f', '#84837b'], 'fill-opacity': ['case', ['==', ['get', 'active'], 1], 0.16, 0.22] } })
      map.addLayer({ id: 'inc-line', type: 'line', source: 'inc', paint: { 'line-color': ['case', ['==', ['get', 'active'], 1], '#ff3b1f', '#84837b'], 'line-width': 1.5, 'line-opacity': 0.8 } })
      map.addLayer({
        id: 'fire-halo',
        type: 'circle',
        source: 'inc-c',
        paint: { 'circle-radius': 16, 'circle-color': '#ff3b1f', 'circle-opacity': 0.35 },
      })
      map.addLayer({
        id: 'hot-dots',
        type: 'circle',
        source: 'hot',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'verdict'], 'possible_fire'], 4, 4.5],
          // Older detections fade so today's activity stands out.
          'circle-opacity': ['max', 0.3, ['-', 1, ['*', 0.25, ['get', 'age']]]],
          'circle-stroke-opacity': ['max', 0.3, ['-', 1, ['*', 0.25, ['get', 'age']]]],
          'circle-color': [
            'match', ['get', 'verdict'],
            'possible_fire', '#ff3b1f',
            'industrial', '#84837b',
            'water', '#404040',
            'other', '#84837b',
            '#f4f3e8',
          ],
          'circle-stroke-color': ['case', ['==', ['get', 'memory'], 1], '#ebfc72', '#13140e'],
          'circle-stroke-width': ['case', ['==', ['get', 'memory'], 1], 2.5, 1],
        },
      })
      map.addLayer({
        id: 'hot-selected',
        type: 'circle',
        source: 'hot',
        filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ebfc72', 'circle-stroke-width': 2 },
      })
      loaded.current = true
      pushData()
    })

    const pick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      if (id != null) onSelectRef.current(String(id))
    }
    const pickIncident = (e: MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: ['hot-dots'] }).length) return // a dot click wins
      const rep = e.features?.[0]?.properties?.rep
      if (rep != null) onSelectRef.current(String(rep))
    }
    map.on('click', 'hot-dots', pick)
    map.on('click', 'inc-fill', pickIncident)
    map.on('click', 'fire-halo', pickIncident)
    for (const layer of ['hot-dots', 'fire-halo', 'inc-fill']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    // Pulse the fire halo: radius and opacity breathe.
    let raf = 0
    const pulse = () => {
      if (map.getLayer('fire-halo')) {
        const t = (performance.now() % 1400) / 1400
        const k = 0.5 - 0.5 * Math.cos(t * Math.PI * 2)
        map.setPaintProperty('fire-halo', 'circle-radius', 12 + 14 * k)
        map.setPaintProperty('fire-halo', 'circle-opacity', 0.45 - 0.35 * k)
      }
      raf = requestAnimationFrame(pulse)
    }
    raf = requestAnimationFrame(pulse)

    return () => {
      cancelAnimationFrame(raf)
      loaded.current = false
      mapRef.current = null
      map.remove()
    }
  }, [])

  useEffect(() => {
    if (busy) setMoved(false)
  }, [busy])

  // Too wide to search (no location yet): show the "Zoom in to search" pill instead.
  useEffect(() => {
    if (!scanRequest || !mapRef.current) return
    if (tooWide) setMoved(true)
    else analyze()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanRequest])

  // Fly to the user's position (the browser asks for permission once); denied or unavailable keeps the current view.
  function locate(map = mapRef.current) {
    if (!map || !('geolocation' in navigator)) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: LOCAL_ZOOM, duration: 1200 })
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }

  function analyze() {
    const m = mapRef.current
    if (!m) return
    const b = m.getBounds()
    setMoved(false)
    onAnalyze([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(3)).join(','))
  }

  useEffect(() => {
    pushData()
    // pushData reads refs; re-run whenever the data or selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, incidents, filter, selectedId])

  useEffect(() => {
    const m = mapRef.current
    if (!fly || !m) return
    // Site zooms keep the point left of the 520 px detail drawer.
    m.flyTo({ center: [fly.lon, fly.lat], zoom: fly.zoom, duration: 1200, offset: fly.zoom >= 13 ? [-260, 0] : [0, 0] })
  }, [fly])

  // maplibre-gl.css forces `position: relative` on the map element, so positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" aria-label="Hotspot map" />
      {moved && !busy && (
        <button
          type="button"
          onClick={analyze}
          disabled={tooWide}
          className="absolute left-1/2 top-[136px] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap bg-lime sm:top-4 px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-canvas shadow-lg hover:brightness-110 disabled:bg-iron disabled:text-ash disabled:hover:brightness-100"
        >
          <Search className="size-4" aria-hidden />
          {tooWide ? 'Zoom in to search' : 'Search this area'}
        </button>
      )}
      <button
        type="button"
        onClick={() => locate()}
        disabled={locating}
        aria-label="My location"
        title="My location"
        className="absolute bottom-14 right-4 flex size-10 items-center justify-center border border-iron bg-canvas/85 text-bone backdrop-blur-sm hover:text-lime disabled:opacity-50"
      >
        <LocateFixed className={`size-5 ${locating ? 'animate-pulse' : ''}`} aria-hidden />
      </button>
    </div>
  )
}
