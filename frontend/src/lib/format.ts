import type { Site, Verdict } from '../types'

export const num = (v: unknown, d = 2): string =>
  typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—'

export const coord = (lat: number, lon: number): string => `${num(lat, 3)}, ${num(lon, 3)}`

export const siteCoord = (s: Site): string =>
  s.hotspot ? coord(s.hotspot.lat, s.hotspot.lon) : '—'

export const ms = (v: unknown): string => (typeof v === 'number' ? `${Math.round(v)} ms` : '')

const UNIT: Record<string, string> = { m: '(m)', ms: '(m/s)', pct: '(%)', c: '(°C)' }
export const humanize = (k: string): string => {
  const s = k.replace(/_/g, ' ').replace(/\b(m|ms|pct|c)\b$/, (u) => UNIT[u] ?? u)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const verdictLabel = (v?: Verdict | string): string =>
  (
    {
      possible_fire: 'Possible fire',
      industrial: 'Industrial (filtered)',
      water: 'Water',
      other: 'Other',
    } as Record<string, string>
  )[v ?? ''] ?? String(v ?? 'Unknown')

export const urgencyOf = (s: Site): number =>
  Math.round(s.report?.scores?.urgency ?? 0)

export const fmtAcq = (s: Site): string => {
  const h = s.hotspot
  if (!h?.acq_date) return ''
  const t = String(h.acq_time ?? '').padStart(4, '0').replace(/^(\d\d)(\d\d)$/, '$1:$2')
  return `${h.acq_date} ${t} UTC`
}
