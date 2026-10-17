import type { FeedItem } from '../types'

const TONE: Record<string, string> = {
  alert: 'text-lime font-normal',
  memory: 'text-lime',
  report: 'text-lime',
  err: 'text-lime',
  sys: 'text-ash',
}

export default function Feed({ items }: { items: FeedItem[] }) {
  return (
    <ol className="h-full overflow-y-auto font-mono text-sm leading-relaxed" aria-label="Activity feed">
      {items.length === 0 && <li className="p-3 text-ash">Waiting for a run…</li>}
      {items.map((it) => (
        <li key={it.id} className={`flex gap-3 px-3 py-0.5 ${TONE[it.kind ?? ''] ?? 'text-bone'}`}>
          <time className="w-14 shrink-0 text-right tabular-nums text-ash">{it.t.toFixed(1)}s</time>
          <span className="truncate" title={it.text}>{it.text}</span>
        </li>
      ))}
    </ol>
  )
}
