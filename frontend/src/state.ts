import type { Focus, FeedItem, Hotspot, Lang, Mode, Probe, Report, RunStatus, Site, Stats, Triage, DayInfo } from './types'
import { siteCoord, verdictLabel, ms, num } from './lib/format'

export interface State {
  sites: Record<string, Site>
  stats: Stats
  day: DayInfo | null
  status: RunStatus
  statusText: string
  mode: Mode | null
  feed: FeedItem[]
  feedSeq: number
  selectedId: string | null
  lang: Lang
  focus: Focus | null
  runId: number
}

export type Action =
  | { type: 'start'; runId: number; mode: Mode; at: number }
  | { type: 'event'; name: string; data: unknown; at: number }
  | { type: 'tick'; elapsed: number }
  | { type: 'status'; status: RunStatus; text: string; at: number }
  | { type: 'feed'; text: string; kind?: FeedItem['kind']; at: number }
  | { type: 'select'; id: string | null }
  | { type: 'lang'; lang: Lang }

const emptyStats = (): Stats => ({ total: 0, industrial: 0, memory: 0, alerts: 0, jev: 0, elapsed: 0 })

export function initialState(): State {
  let lang: Lang = 'en'
  try {
    if (localStorage.getItem('ws-lang') === 'ja') lang = 'ja'
  } catch {
    /* storage unavailable */
  }
  return {
    sites: {},
    stats: emptyStats(),
    day: null,
    status: 'idle',
    statusText: 'Ready',
    mode: null,
    feed: [],
    feedSeq: 0,
    selectedId: null,
    lang,
    focus: null,
    runId: 0,
  }
}

const FEED_CAP = 300

function pushFeed(state: State, text: string, kind: FeedItem['kind'], at: number): State {
  const item: FeedItem = { id: state.feedSeq + 1, t: at, text, kind }
  return { ...state, feedSeq: item.id, feed: [item, ...state.feed].slice(0, FEED_CAP) }
}

function withSite(state: State, id: string, patch: Partial<Site>): State {
  const prev = state.sites[id] ?? { id }
  return { ...state, sites: { ...state.sites, [id]: { ...prev, ...patch } } }
}

// Mirrors app.js handlers: the counting rules here are the spec.
function onEvent(state: State, name: string, raw: unknown, at: number): State {
  const d = (raw ?? {}) as Record<string, unknown>
  switch (name) {
    case 'hotspot': {
      const h = raw as Hotspot
      const isNew = !state.sites[h.id]?.hotspot
      const next = withSite(state, h.id, { id: h.id, hotspot: h })
      return isNew ? { ...next, stats: { ...next.stats, total: next.stats.total + 1 } } : next
    }
    case 'triage': {
      const t = raw as Triage
      const prev = state.sites[t.id]?.triage
      let stats = state.stats
      if (!prev) {
        stats = {
          ...stats,
          industrial: stats.industrial + (t.verdict === 'industrial' ? 1 : 0),
          memory: stats.memory + (t.source === 'memory' ? 1 : 0),
          jev: stats.jev + (t.source !== 'memory' ? 1 : 0),
          alerts: stats.alerts + (t.verdict === 'possible_fire' ? 1 : 0),
        }
      }
      let next = withSite({ ...state, stats }, t.id, {
        id: t.id,
        triage: t,
        alertAt: t.verdict === 'possible_fire' ? (state.sites[t.id]?.alertAt ?? at) : state.sites[t.id]?.alertAt,
      })
      const s = next.sites[t.id]
      next = t.source === 'memory'
        ? pushFeed(next, `Memory hit: ${verdictLabel(t.verdict)} site ${siteCoord(s)} · ${ms(t.latency_ms)}`, 'memory', at)
        : pushFeed(next, `Jev → ${t.verdict} (${num(t.confidence)}) · ${ms(t.latency_ms)}`, undefined, at)
      if (t.verdict === 'possible_fire') {
        next = pushFeed(next, `ALERT possible fire at ${siteCoord(s)}`, 'alert', at)
      }
      return next
    }
    case 'probe': {
      const p = raw as Probe
      const prev = state.sites[p.id]?.probe
      const stats = { ...state.stats, jev: state.stats.jev + (prev ? 0 : 1) }
      const next = withSite({ ...state, stats }, p.id, { id: p.id, probe: p })
      return pushFeed(next, `Jev deep probe: ${Object.keys(p.answers ?? {}).length} answers · ${ms(p.latency_ms)}`, 'sys', at)
    }
    case 'report': {
      const r = raw as Report
      const u = r.scores?.urgency
      let next = withSite(state, r.id, { id: r.id, report: r })
      next = pushFeed(
        next,
        r.brief_pending ? `Assessment: urgency ${u ?? '?'}/5 (rules)` : `ai& report: urgency ${u ?? '?'}/5${r.latency_ms ? ' · ' + ms(r.latency_ms) : ''}`,
        'report',
        at,
      )
      return next
    }
    case 'summary': {
      const stats: Stats = {
        ...state.stats,
        total: typeof d.total === 'number' ? d.total : state.stats.total,
        industrial: typeof d.filtered_industrial === 'number' ? d.filtered_industrial : state.stats.industrial,
        memory: typeof d.memory_hits === 'number' ? d.memory_hits : state.stats.memory,
        alerts: typeof d.alerts === 'number' ? d.alerts : state.stats.alerts,
        jev: typeof d.jev_calls === 'number' ? d.jev_calls : state.stats.jev,
        elapsed: typeof d.elapsed_s === 'number' ? d.elapsed_s : state.stats.elapsed,
      }
      const inJp = d.in_japan != null ? ` (${String(d.in_japan)} imaged)` : ''
      const weak = typeof d.skipped_weak === 'number' && d.skipped_weak > 0 ? `, ${String(d.skipped_weak)} weaker ones skipped (zoom in to analyse them)` : ''
      return pushFeed(
        { ...state, stats },
        `Summary: ${String(d.total)} hotspots${inJp}, ${String(d.filtered_industrial)} industrial filtered, ${String(d.alerts)} alert(s), ${String(d.jev_calls)} Jev calls in ${num(d.elapsed_s, 1)} s${weak}`,
        'sys',
        at,
      )
    }
    case 'day': {
      const day = {
        index: Number(d.index), of: Number(d.of), date: String(d.date),
        detections: d.detections != null ? Number(d.detections) : undefined,
        rain_mm: d.rain_mm != null ? Number(d.rain_mm) : undefined,
      }
      const extra = `${day.detections != null ? ` · ${day.detections} satellite detections` : ''}${day.rain_mm ? ` · rain ${day.rain_mm} mm` : ''}`
      return pushFeed({ ...state, day }, `── Day ${day.index}/${day.of}: ${day.date}${extra} ──`, 'sys', at)
    }
    case 'analysis_error':
      return pushFeed(state, `Analysis failed: ${String(d.message ?? '')}`, 'err', at)
    default:
      return state
  }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start': {
      const replay = action.mode === 'replay'
      const label = replay ? 'Replay · Ofunato 2025' : action.mode === 'drill' ? 'Drill · Ashikaga brush fire, today' : 'Live · today'
      const base: State = {
        ...initialState(),
        lang: state.lang,
        mode: action.mode,
        runId: action.runId,
        status: 'running',
        statusText: `${label} — streaming…`,
        focus: replay
          ? { lat: 39.05, lon: 141.78, zoom: 11, nonce: action.runId }
          : action.mode === 'drill'
            ? { lat: 36.3427, lon: 139.4462, zoom: 13, nonce: action.runId }
            : null,
      }
      return pushFeed(base, `Run started: ${label}`, 'sys', action.at)
    }
    case 'event':
      return onEvent(state, action.name, action.data, action.at)
    case 'tick':
      return { ...state, stats: { ...state.stats, elapsed: action.elapsed } }
    case 'status': {
      const next = { ...state, status: action.status, statusText: action.text }
      return action.status === 'done' ? pushFeed(next, action.text, 'sys', action.at) : next
    }
    case 'feed':
      return pushFeed(state, action.text, action.kind, action.at)
    case 'select':
      return { ...state, selectedId: action.id }
    case 'lang':
      return { ...state, lang: action.lang }
  }
}
