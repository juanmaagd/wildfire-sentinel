import type { Stats } from '../types'

export default function Kpis({ stats, alerts }: { stats: Stats; alerts: number }) {
  const items: [string, number | string, string, boolean][] = [
    ['Hotspots', stats.total, 'text-bone', false],
    ['Industrial filtered', stats.industrial, 'text-ash', false],
    ['Memory hits', stats.memory, 'text-bone', false],
    ['Alerts', alerts, 'text-lime', alerts > 0],
    ['Jev calls', stats.jev, 'text-bone', false],
    ['Elapsed (s)', stats.elapsed.toFixed(1), 'text-bone', false],
  ]
  return (
    <div className="grid grid-cols-3 border-l border-t border-iron">
      {items.map(([label, value, color, hot]) => (
        <div key={label} className={`border-b border-r border-iron px-4 py-3 ${hot ? 'ring-1 ring-inset ring-lime/60' : ''}`}>
          <div className="font-mono text-xs uppercase tracking-[0.08em] text-ash">{label}</div>
          <div className={`font-mono text-[44px] font-light leading-none tabular-nums ${color}`}>{value}</div>
        </div>
      ))}
    </div>
  )
}
