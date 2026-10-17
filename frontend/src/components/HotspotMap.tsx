import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef } from 'react'
import { Map as MLMap, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from 'maplibre-gl'
import type { Focus, Site } from '../types'

const BASE: StyleSpecification = {
  version: 8,
  sources: {
    gsi: {
      type: 'raster',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">出典：国土地理院</a>',
    },
  },
  layers: [
    { id: 'sea', type: 'background', paint: { 'background-color': '#0b2a3a' } },
    {
      id: 'gsi',
      type: 'raster',
      source: 'gsi',
      paint: {
        'raster-saturation': -0.95,
        'raster-contrast': 0.1,
        'raster-brightness-min': 0.02,
        'raster-brightness-max': 0.2,
      },
    },
  ],
}

const JAPAN: [[number, number], [number, number]] = [[127, 29.5], [146.5, 46]]
const EMPTY = { type: 'FeatureCollection' as const, features: [] as Feature[] }

export function toGeoJSON(sites: Record<string, Site>): FeatureCollection {
  const features: Feature[] = []
  for (const s of Object.values(sites)) {
    const h = s.hotspot
    if (!h) continue
    features.push({
      type: 'Feature',
      properties: {
        id: s.id,
        verdict: s.triage?.verdict ?? 'pending',
        memory: s.triage?.source === 'memory' ? 1 : 0,
      },
      geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

interface Props {
  sites: Record<string, Site>
  selectedId: string | null
  fly: Focus | null
  onSelect: (id: string) => void
}

export default function HotspotMap({ sites, selectedId, fly, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const loaded = useRef(false)
  const geo = toGeoJSON(sites)
  const geoRef = useRef(geo)
  geoRef.current = geo
  const selRef = useRef(selectedId)
  selRef.current = selectedId
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const pushData = () => {
    const m = mapRef.current
    if (!m || !loaded.current) return
    ;(m.getSource('hot') as GeoJSONSource | undefined)?.setData(geoRef.current)
    m.setFilter('hot-selected', ['==', ['get', 'id'], selRef.current ?? ''])
  }

  useEffect(() => {
    if (!el.current) return
    const map = new MLMap({
      container: el.current,
      style: BASE,
      bounds: JAPAN,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
    })
    mapRef.current = map

    map.on('load', () => {
      map.addSource('hot', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'fire-halo',
        type: 'circle',
        source: 'hot',
        filter: ['==', ['get', 'verdict'], 'possible_fire'],
        paint: { 'circle-radius': 16, 'circle-color': '#ff3b1f', 'circle-opacity': 0.35 },
      })
      map.addLayer({
        id: 'hot-dots',
        type: 'circle',
        source: 'hot',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'verdict'], 'possible_fire'], 8, 5],
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
    map.on('click', 'hot-dots', pick)
    map.on('click', 'fire-halo', pick)
    for (const layer of ['hot-dots', 'fire-halo']) {
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
    pushData()
    // pushData reads refs; re-run whenever the data or selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, selectedId])

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
    </div>
  )
}
