export interface RealityPoint {
  time: string | null
  hours: number
  official_ha: number
  predicted_ha: number
  source: string
}

interface Props {
  points: RealityPoint[]
  areaByHour: Record<string, number> // predicted area at the model horizons
  hour: number
}

const W = 360
const H = 120
const PAD = { l: 40, r: 8, t: 8, b: 18 }
const PRED = '#ff8a1f'
const REAL = '#f4f3e8'
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

// Predicted vs official burned area over time (Ofunato replay): one axis, two series, legend + hover titles.
export default function RealityCheck({ points, areaByHour, hour }: Props) {
  const curve = [
    [0, 0] as [number, number],
    ...Object.entries(areaByHour).map(([h, a]) => [Number(h), a] as [number, number]),
    ...points.map((p) => [p.hours, p.predicted_ha] as [number, number]),
  ].sort((a, b) => a[0] - b[0])
  const maxH = Math.max(...curve.map((c) => c[0]))
  const maxA = Math.max(...curve.map((c) => c[1]), ...points.map((p) => p.official_ha)) * 1.08
  const x = (h: number) => PAD.l + (h / maxH) * (W - PAD.l - PAD.r)
  const y = (a: number) => H - PAD.b - (a / maxA) * (H - PAD.t - PAD.b)
  const first = points[0]
  const err = first ? Math.round((100 * (first.predicted_ha - first.official_ha)) / first.official_ha) : 0
  const worst = points.length ? Math.max(...points.map((p) => p.predicted_ha / p.official_ha)) : 0

  return (
    <div className="mt-3 border-t border-iron pt-3">
      <div className="font-mono text-[11px] uppercase tracking-wider text-ash">Reality check · burned area</div>
      {first && (
        <div className="mt-1 text-[15px] text-bone">
          +{Math.round(first.hours)} h: <span className="text-lime">{fmt(first.predicted_ha)} ha predicted</span> vs {fmt(first.official_ha)} ha
          real ({err > 0 ? '+' : ''}
          {err}%)
        </div>
      )}
      <svg width={W} height={H} className="mt-2 font-mono" role="img" aria-label="Predicted versus official burned area over time">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(maxA * f)} y2={y(maxA * f)} stroke="#404040" strokeWidth={1} />
            <text x={PAD.l - 4} y={y(maxA * f) + 3} textAnchor="end" fontSize={9} fill="#84837b">
              {fmt(maxA * f)}
            </text>
          </g>
        ))}
        {[0, 48, 96, 144].filter((h) => h <= maxH).map((h) => (
          <text key={h} x={x(h)} y={H - 4} textAnchor="middle" fontSize={9} fill="#84837b">
            +{h}h
          </text>
        ))}
        <line x1={x(Math.min(hour, maxH))} x2={x(Math.min(hour, maxH))} y1={PAD.t} y2={H - PAD.b} stroke="#ebfc72" strokeWidth={1} strokeDasharray="3 3" />
        <polyline points={curve.map(([h, a]) => `${x(h)},${y(a)}`).join(' ')} fill="none" stroke={PRED} strokeWidth={2} />
        {points.map((p) => (
          <g key={p.hours}>
            <circle cx={x(p.hours)} cy={y(p.official_ha)} r={8} fill="transparent">
              <title>{`${p.source}: ${fmt(p.official_ha)} ha real · ${fmt(p.predicted_ha)} ha predicted at +${Math.round(p.hours)} h`}</title>
            </circle>
            <circle cx={x(p.hours)} cy={y(p.official_ha)} r={4} fill={REAL} stroke="#13140e" strokeWidth={2} pointerEvents="none" />
          </g>
        ))}
      </svg>
      <div className="flex gap-4 font-mono text-[11px] uppercase tracking-wider text-ash">
        <span className="inline-flex items-center gap-2"><i className="h-[2px] w-4" style={{ background: PRED }} />predicted</span>
        <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-bone" />official</span>
      </div>
      {worst > 1.2 && (
        <div className="mt-1 max-w-[360px] text-[12px] leading-snug text-ash">
          The curve is the fire with no firefighting: weather and terrain only, calibrated on 18 fires' first 30 h. The real fire stayed smaller (up to ×{worst.toFixed(1)} gap); that gap includes the effect of suppression, and model error. Sources: {points.map((p) => p.source).join('; ')}.
        </div>
      )}
    </div>
  )
}
