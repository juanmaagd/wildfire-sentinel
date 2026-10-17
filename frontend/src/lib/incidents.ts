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
  lastDay: string
  active: boolean // detected on the current replay day (or the day before); false = extinguished
}

const km = (a: Site, b: Site) => {
  const [la1, lo1, la2, lo2] = [a.hotspot!.lat, a.hotspot!.lon, b.hotspot!.lat, b.hotspot!.lon]
  const dy = (la2 - la1) * 111.32
  const dx = (lo2 - lo1) * 111.32 * Math.cos(((la1 + la2) / 2) * (Math.PI / 180))
  return Math.hypot(dx, dy)
}

// Tight outline: convex hull of a ~BUFFER_KM ring around every detection (rounded, follows the real shape).
const BUFFER_KM = 0.5

function hullOutline(points: [number, number][]): Feature<Polygon> {
  const pts: [number, number][] = []
  for (const [lon, lat] of points) {
    const kx = 111.32 * Math.cos((lat * Math.PI) / 180)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI
      pts.push([lon + (BUFFER_KM * Math.cos(a)) / kx, lat + (BUFFER_KM * Math.sin(a)) / 111.32])
    }
  }
  // Andrew's monotone chain.
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const ring = lower.slice(0, -1).concat(upper.slice(0, -1))
  ring.push(ring[0])
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

export function circle(lon: number, lat: number, radiusKm: number): Feature<Polygon> {
  const pts: [number, number][] = []
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI
    pts.push([lon + (radiusKm * Math.cos(a)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (radiusKm * Math.sin(a)) / 111.32])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } }
}

export function buildIncidents(sites: Record<string, Site>, currentDay?: string): Incident[] {
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
        lastDay: [...g.map((s) => s.hotspot!.acq_date ?? '')].sort().at(-1) ?? '',
        maxFrp: Math.max(...g.map((s) => s.hotspot!.frp ?? 0)),
        center: [lon, lat] as [number, number],
        outline: hullOutline(g.map((s) => [s.hotspot!.lon, s.hotspot!.lat] as [number, number])),
        first: Math.min(...g.map((s) => s.alertAt ?? 0)),
      }
    })
    .sort((a, b) => a.first - b.first)
    .map((inc, i) => {
      // Extinguished when the satellites have not seen it today or yesterday (replay days are sequential).
      const quietDays = currentDay && inc.lastDay ? (Date.parse(currentDay) - Date.parse(inc.lastDay)) / 86400000 : 0
      return { ...inc, id: `fire-${i + 1}`, n: i + 1, active: quietDays <= 1 }
    })
}
