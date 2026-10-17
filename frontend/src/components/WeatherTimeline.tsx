import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface HourWeather {
  time: string
  wind_speed_ms: number
  wind_gust_ms: number | null
  wind_from_deg: number
  humidity_pct: number
  precip_mm: number
}

export interface Props {
  hourly: HourWeather[]
  hour: number
  onHour: (h: number) => void
  marks?: number[]
}

const H = 168
const PAD_TOP = 8
const WIND_H = 56
const HUM_H = 40
const RAIN_H = 40
const GAP = 4
const LABEL_H = 16

const WIND_TOP = PAD_TOP
const WIND_BOT = WIND_TOP + WIND_H // 64
const HUM_TOP = WIND_BOT + GAP // 68
const HUM_BOT = HUM_TOP + HUM_H // 108
const RAIN_TOP = HUM_BOT + GAP // 112
const RAIN_BOT = RAIN_TOP + RAIN_H // 152
const LABEL_BASE = RAIN_BOT + LABEL_H - 4 // 164

const RAIN_EVENT_MM = 0.5
const TIP_W = 196
const TIP_PAD_Y = 6
const TIP_LINE_H = 15
const TIP_LINES = 5
const TIP_H = TIP_PAD_Y * 2 + TIP_LINE_H * TIP_LINES

const C = {
  canvas: '#13140e',
  bone: '#f4f3e8',
  ash: '#84837b',
  iron: '#404040',
  lime: '#ebfc72',
  rain: '#6cb6ff',
} as const

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function compass(deg: number): string {
  const d = ((deg % 360) + 360) % 360
  return COMPASS[Math.round(d / 22.5) % 16]
}

function linePath(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null || Number.isNaN(v)) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `
    pen = true
  })
  return d.trim()
}

interface RainRun {
  start: number
  end: number
  total: number
}

export default function WeatherTimeline({ hourly, hour, onHour, marks = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef(false)
  const [width, setWidth] = useState(0)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = hourly.length
  const maxHour = Math.max(0, n - 1)
  const step = n > 1 ? width / (n - 1) : width
  const x = (i: number) => i * step
  const scrubX = x(clamp(hour, 0, maxHour))

  // Per-row y scales (each row has its own scale).
  const rawWindMax = hourly.reduce(
    (m, h) => Math.max(m, h.wind_speed_ms, h.wind_gust_ms ?? 0),
    0,
  )
  const windYMax = rawWindMax > 0 ? rawWindMax * 1.1 : 1
  const rainYMax = hourly.reduce((m, h) => Math.max(m, h.precip_mm), 2)
  const windY = (v: number) => WIND_BOT - (v / windYMax) * WIND_H
  const humY = (v: number) => HUM_BOT - (v / 100) * HUM_H
  const rainBarH = (v: number) => (v / rainYMax) * RAIN_H

  const windPath = linePath(
    hourly.map((h) => h.wind_speed_ms),
    x,
    windY,
  )
  const gustPath = linePath(
    hourly.map((h) => h.wind_gust_ms),
    x,
    windY,
  )
  const humPath = linePath(
    hourly.map((h) => h.humidity_pct),
    x,
    humY,
  )

  const runs: RainRun[] = []
  let cur: RainRun | null = null
  for (let i = 0; i < n; i++) {
    const p = hourly[i].precip_mm
    if (p >= RAIN_EVENT_MM) {
      if (cur === null) cur = { start: i, end: i, total: 0 }
      cur.end = i
      cur.total += p
    } else if (cur !== null) {
      runs.push(cur)
      cur = null
    }
  }
  if (cur !== null) runs.push(cur)

  const dayIndices: number[] = []
  for (let i = 0; i < n; i++) {
    if (hourly[i].time.endsWith('T00:00')) dayIndices.push(i)
  }

  const hourAt = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || step <= 0) return 0
    return clamp(Math.round((clientX - rect.left) / step), 0, maxHour)
  }

  const localPoint = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    const idx = hourAt(e.clientX)
    setHoverIdx(idx)
    setPointer(localPoint(e))
    onHour(idx)
  }

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const idx = hourAt(e.clientX)
    setHoverIdx(idx)
    setPointer(localPoint(e))
    if (draggingRef.current) onHour(idx)
  }

  const handlePointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const handlePointerLeave = () => {
    if (draggingRef.current) return
    setHoverIdx(null)
    setPointer(null)
  }

  const hovered = hoverIdx !== null ? hourly[hoverIdx] : undefined
  let tipEl = null
  if (hoverIdx !== null && pointer && hovered) {
    const t = hovered
    const lines = [
      `${t.time.slice(5, 10)} ${t.time.slice(11, 16)} JST`,
      `wind ${t.wind_speed_ms.toFixed(1)} m/s from ${compass(t.wind_from_deg)}`,
      `gust ${t.wind_gust_ms === null ? '—' : t.wind_gust_ms.toFixed(1)}`,
      `RH ${Math.round(t.humidity_pct)}%`,
      `rain ${t.precip_mm.toFixed(1)} mm`,
    ]
    let tx = pointer.x + 12
    if (tx + TIP_W > width) tx = pointer.x - 12 - TIP_W
    tx = clamp(tx, 0, Math.max(0, width - TIP_W))
    const ty = clamp(pointer.y + 12, 0, H - TIP_H)
    tipEl = (
      <g pointerEvents="none">
        <rect
          x={tx}
          y={ty}
          width={TIP_W}
          height={TIP_H}
          fill={C.canvas}
          stroke={C.iron}
          strokeWidth={1}
        />
        {lines.map((line, i) => (
          <text
            key={i}
            x={tx + 8}
            y={ty + TIP_PAD_Y + 11 + i * TIP_LINE_H}
            fontSize={12}
            fill={C.bone}
          >
            {line}
          </text>
        ))}
      </g>
    )
  }

  return (
    <div ref={containerRef} className="w-full">
      {width > 0 && (
        <svg
          ref={svgRef}
          role="img"
          aria-label={`Hourly weather: wind, humidity and rain over ${n} hours`}
          className="font-mono"
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          style={{ display: 'block', cursor: 'ew-resize', touchAction: 'none', userSelect: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        >
          {/* Rain event bands across all three rows */}
          {runs.map((r) => {
            const left = Math.max(0, x(r.start) - step / 2)
            const right = Math.min(width, x(r.end) + step / 2)
            return (
              <rect
                key={`band-${r.start}`}
                x={left}
                y={WIND_TOP}
                width={Math.max(0, right - left)}
                height={RAIN_BOT - WIND_TOP}
                fill={C.rain}
                opacity={0.12}
                pointerEvents="none"
              />
            )
          })}

          {/* Day boundaries */}
          {dayIndices.map((i) => (
            <g key={`day-${i}`} pointerEvents="none">
              <line
                x1={x(i)}
                x2={x(i)}
                y1={WIND_TOP}
                y2={RAIN_BOT}
                stroke={C.iron}
                strokeWidth={1}
              />
              <text x={x(i) + 3} y={LABEL_BASE} fontSize={11} fill={C.ash}>
                {hourly[i].time.slice(5, 10)}
              </text>
            </g>
          ))}

          {/* Row baselines */}
          {[WIND_BOT, HUM_BOT, RAIN_BOT].map((y) => (
            <line
              key={`base-${y}`}
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              stroke={C.iron}
              strokeWidth={1}
              pointerEvents="none"
            />
          ))}

          {/* Wind row */}
          <text x={4} y={WIND_TOP + 11} fontSize={11} fill={C.ash} pointerEvents="none">
            WIND m/s
          </text>
          <text x={92} y={WIND_TOP + 11} fontSize={11} fill={C.ash} pointerEvents="none">
            — wind  - - gust
          </text>
          {windPath && (
            <path d={windPath} fill="none" stroke={C.bone} strokeWidth={2} pointerEvents="none" />
          )}
          {gustPath && (
            <path
              d={gustPath}
              fill="none"
              stroke={C.ash}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}

          {/* Humidity row */}
          <text x={4} y={HUM_TOP + 11} fontSize={11} fill={C.ash} pointerEvents="none">
            HUMIDITY %
          </text>
          {humPath && (
            <path d={humPath} fill="none" stroke={C.bone} strokeWidth={2} pointerEvents="none" />
          )}

          {/* Rain row */}
          <text x={4} y={RAIN_TOP + 11} fontSize={11} fill={C.ash} pointerEvents="none">
            RAIN mm/h
          </text>
          {hourly.map((h, i) => {
            const bh = rainBarH(h.precip_mm)
            if (bh <= 0) return null
            const barW = Math.max(1, step - 1)
            return (
              <rect
                key={`bar-${i}`}
                x={x(i) - step / 2 + 0.5}
                y={RAIN_BOT - Math.max(1, bh)}
                width={barW}
                height={Math.max(1, bh)}
                fill={C.rain}
                pointerEvents="none"
              />
            )
          })}

          {/* Rain event labels above the Rain row */}
          {runs.map((r) => {
            const left = Math.max(0, x(r.start) - step / 2)
            const right = Math.min(width, x(r.end) + step / 2)
            const label = `RAIN ${r.total.toFixed(1)} mm · ${hourly[r.start].time.slice(5, 10)}`
            const alignRight = left > width * 0.6
            return (
              <text
                key={`label-${r.start}`}
                x={alignRight ? right - 3 : left + 3}
                y={RAIN_TOP - 4}
                fontSize={11}
                fill={C.rain}
                textAnchor={alignRight ? 'end' : 'start'}
                pointerEvents="none"
              >
                {label}
              </text>
            )
          })}

          {/* Horizon marks on the x axis */}
          {marks
            .filter((m) => m >= 0 && m <= maxHour)
            .map((m) => (
              <line
                key={`mark-${m}`}
                x1={x(m)}
                x2={x(m)}
                y1={RAIN_BOT}
                y2={RAIN_BOT + 4}
                stroke={C.ash}
                strokeWidth={1}
                pointerEvents="none"
              />
            ))}

          {/* Hover crosshair and tooltip */}
          {hoverIdx !== null && hovered && (
            <line
              x1={x(hoverIdx)}
              x2={x(hoverIdx)}
              y1={WIND_TOP}
              y2={RAIN_BOT}
              stroke={C.bone}
              strokeOpacity={0.5}
              strokeWidth={1}
              pointerEvents="none"
            />
          )}
          {tipEl}

          {/* Scrubber */}
          <line
            x1={scrubX}
            x2={scrubX}
            y1={0}
            y2={RAIN_BOT}
            stroke={C.lime}
            strokeWidth={2}
            pointerEvents="none"
          />
          <rect x={scrubX - 4} y={0} width={8} height={8} fill={C.lime} pointerEvents="none" />
        </svg>
      )}
    </div>
  )
}
