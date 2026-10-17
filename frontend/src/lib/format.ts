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

// Japan time for display: FIRMS gives UTC acquisition date + HHMM; the app shows JST everywhere.
const JST = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export const toJst = (d: Date | string): string => `${JST.format(typeof d === 'string' ? new Date(d) : d)} JST`

export const acqDate = (h: { acq_date?: string; acq_time?: string | number }): Date | null => {
  if (!h.acq_date) return null
  const t = String(h.acq_time ?? '0').padStart(4, '0')
  return new Date(`${h.acq_date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`)
}

export const fmtAcq = (s: Site): string => {
  const d = s.hotspot ? acqDate(s.hotspot) : null
  return d ? toJst(d) : ''
}
