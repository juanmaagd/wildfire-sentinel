import type { Feature, Polygon } from 'geojson'
import type { Site } from '../types'

// Many satellite detections (375 m pixels) belong to the same fire: group possible-fire sites within LINK_KM.
const LINK_KM = 2

export interface Incident {
  id: string
  n: number
  sites: Site[]
  rep: Site // detail / report / 3D open on this detection
  detections: number
  days: string[]
  maxFrp: number
  center: [number, number] // lon, lat
  outline: Feature<Polygon>
}

const km = (a: Site, b: Site) => {
  const [la1, lo1, la2, lo2] = [a.hotspot!.lat, a.hotspot!.lon, b.hotspot!.lat, b.hotspot!.lon]
  const dy = (la2 - la1) * 111.32
  const dx = (lo2 - lo1) * 111.32 * Math.cos(((la1 + la2) / 2) * (Math.PI / 180))
  return Math.hypot(dx, dy)
}

function circle(lon: number, lat: number, radiusKm: number): Feature<Polygon> {
  const pts: [number, number][] = []
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI
    pts.push([lon + (radiusKm * Math.cos(a)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (radiusKm * Math.sin(a)) / 111.32])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } }
}

export function buildIncidents(sites: Record<string, Site>): Incident[] {
  const fires = Object.values(sites)
    .filter((s) => s.hotspot && s.triage?.verdict === 'possible_fire')
    .sort((a, b) => (a.alertAt ?? 0) - (b.alertAt ?? 0))
  const groups: Site[][] = []
  for (const s of fires) {
    const hits = groups.filter((g) => g.some((o) => km(o, s) <= LINK_KM))
    if (!hits.length) groups.push([s])
    else {
      const merged = hits.flat().concat(s)
      for (const h of hits) groups.splice(groups.indexOf(h), 1)
      groups.push(merged)
    }
  }
  return groups
    .map((g) => {
      const lon = g.reduce((a, s) => a + s.hotspot!.lon, 0) / g.length
      const lat = g.reduce((a, s) => a + s.hotspot!.lat, 0) / g.length
      const center = { hotspot: { lat, lon } } as Site
      const radius = Math.max(...g.map((s) => km(center, s))) + 0.6
      const rep =
        g.find((s) => s.report && !s.report.brief_pending) ??
        g.find((s) => s.report) ??
        [...g].sort((a, b) => (b.hotspot!.frp ?? 0) - (a.hotspot!.frp ?? 0))[0]
      return {
        id: '',
        n: 0,
        sites: g,
        rep,
        detections: g.reduce((a, s) => a + (s.hotspot!.detections ?? 1), 0),
        days: [...new Set(g.map((s) => s.hotspot!.acq_date).filter(Boolean) as string[])].sort(),
        maxFrp: Math.max(...g.map((s) => s.hotspot!.frp ?? 0)),
        center: [lon, lat] as [number, number],
        outline: circle(lon, lat, radius),
        first: Math.min(...g.map((s) => s.alertAt ?? 0)),
      }
    })
    .sort((a, b) => a.first - b.first)
    .map((inc, i) => ({ ...inc, id: `fire-${i + 1}`, n: i + 1 }))
}
