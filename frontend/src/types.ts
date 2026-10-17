export type Verdict = 'possible_fire' | 'industrial' | 'water' | 'other'
export type Mode = 'live' | 'replay' | 'drill'
export type Lang = 'en' | 'ja'

export interface Hotspot {
  id: string
  lat: number
  lon: number
  frp: number | null
  acq_date?: string
  acq_time?: string | number
  detections?: number
}

export interface Signal {
  value?: unknown
  probability?: number
  confidence?: number
}

export interface Triage {
  id: string
  verdict: Verdict
  source: 'jev' | 'memory'
  confidence?: number
  signals?: Record<string, Signal | boolean | number | string>
  latency_ms?: number
  image_url?: string | null
}

export interface Probe {
  id: string
  latency_ms?: number
  images?: Record<string, string>
  answers?: Record<string, Signal | unknown>
}

export interface Scores {
  danger: number
  spread_risk: number
  exposure: number
  urgency: number
}

export interface Report {
  id: string
  scores: Scores
  confidence?: string | number
  headline_ja?: string
  headline_en?: string
  brief_ja?: string
  brief_en?: string
  key_evidence?: string[]
  unknowns?: string[]
  recommended_actions?: string[]
  weather?: Record<string, unknown>
  latency_ms?: number
  generated_at?: string
  model?: string
  brief_pending?: boolean
  detected_at?: string
}

export interface Site {
  id: string
  hotspot?: Hotspot
  triage?: Triage
  probe?: Probe
  report?: Report
  alertAt?: number
}

export interface Stats {
  total: number
  industrial: number
  memory: number
  alerts: number
  jev: number
  elapsed: number
}

export interface DayInfo {
  index: number
  of: number
  date: string
  detections?: number
  rain_mm?: number
}

export interface FeedItem {
  id: number
  t: number
  text: string
  kind?: 'sys' | 'alert' | 'memory' | 'report' | 'err'
}

export interface Focus {
  lat: number
  lon: number
  zoom: number
  nonce: number
}

export type RunStatus = 'idle' | 'running' | 'done' | 'error'
