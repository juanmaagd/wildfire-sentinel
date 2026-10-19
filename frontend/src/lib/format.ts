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

// Dates are shown in the viewer's own time zone and locale format (browser settings), wherever the fire is.
const asDate = (d: Date | string): Date => (typeof d === 'string' ? new Date(d) : d)
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const DAY_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const ZONE = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
  .formatToParts(new Date())
  .find((p) => p.type === 'timeZoneName')?.value ?? ''

export const fmtDateTime = (d: Date | string): string => `${DATE_TIME.format(asDate(d))} ${ZONE}`
export const fmtDayTime = (d: Date | string): string => DAY_TIME.format(asDate(d))
export const fmtDay = (d: Date | string): string => DAY.format(asDate(d))
export const fmtTime = (d: Date | string): string => TIME.format(asDate(d))
export const localZone = ZONE

// The backend asks Open-Meteo for Japan time, so forecast hours arrive as naive JST strings ("YYYY-MM-DDTHH:MM"
// or "YYYY-MM-DD HH:MM JST"); pin them to +09:00 so they convert to the viewer's zone like any other instant.
export const fromJst = (naive: string): Date => new Date(`${naive.replace(' JST', '').replace(' ', 'T').slice(0, 16)}:00+09:00`)

export const acqDate = (h: { acq_date?: string; acq_time?: string | number }): Date | null => {
  if (!h.acq_date) return null
  const t = String(h.acq_time ?? '0').padStart(4, '0')
  return new Date(`${h.acq_date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`)
}

export const fmtAcq = (s: Site): string => {
  const d = s.hotspot ? acqDate(s.hotspot) : null
  return d ? fmtDateTime(d) : ''
}
