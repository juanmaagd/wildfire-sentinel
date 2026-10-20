import { useEffect, useMemo, useState } from 'react'
import { InteractiveNvlWrapper } from '@neo4j-nvl/react'
import type { Node, Relationship } from '@neo4j-nvl/base'
import { X } from 'lucide-react'

interface GNode {
  id: string
  kind: 'Detection' | 'FireDay' | 'Site'
  lat: number | null
  lon: number | null
  frp: number | null
  satellite: string | null // site name for Site nodes
  at: string | null // date for FireDay nodes
  hours: number | null // rain mm for FireDay nodes
}
interface GRel {
  from: string
  to: string
  type: 'SPREAD_TO' | 'ON_DAY' | 'NEXT' | 'SEEN_AT'
  km: number | null
  hours: number | null
}
interface Insights {
  ignitions: { id: string; at: string; hours: number }[]
  longest_path: { hops: number; ids: string[]; from_h: number; to_h: number; km: number }[]
  hubs: { id: string; descendants: number; hours: number }[]
  fastest: { from: string; to: string; km: number; hours: number; km_h: number }[]
  per_day: { date: string; rain_mm: number; detections: number; spread_links: number; max_frp: number }[]
  jev_sites: { sites: number; detections: number }[]
  summary: { detections: number; first_pass: number; new_fronts: { id: string; hours: number }[]; spread_links: number }
}
interface GraphData {
  incident: string
  name: string
  nodes: GNode[]
  rels: GRel[]
  insights: Insights
  cypher: { spread: string }
}

interface Props {
  lat: number
  lon: number
  day: string
  name: string
  onClose: () => void
}

type Focus = 'none' | 'path' | 'hub' | 'fronts' | 'fastest'

const BONE = '#f4f3e8'
const ASH = '#84837b'
const IRON = '#404040'
const LIME = '#ebfc72'
const RAIN = '#6cb6ff'

// Same fire ramp as the 3D perimeters: early detections yellow, late ones dark red.
function fireColor(hours: number): string {
  const stops: [number, string][] = [[0, '#ffd000'], [12, '#ffb000'], [24, '#ff8a1f'], [48, '#e0461f'], [96, '#8b1010']]
  for (let i = stops.length - 1; i >= 0; i--) if (hours >= stops[i][0]) return stops[i][1]
  return stops[0][1]
}

export default function FireGraphView({ lat, lon, day, name, onClose }: Props) {
  const [data, setData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [layers, setLayers] = useState({ days: true, sites: true })
  const [focus, setFocus] = useState<Focus>('none')
  const [picked, setPicked] = useState<GNode | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), day, name })
    fetch(`/api/graph?${q}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: GraphData) => setData(d))
      .catch((e: Error) => !ac.signal.aborted && setError(e.message))
    return () => ac.abort()
  }, [lat, lon, day, name])

  // Node ids highlighted by the selected insight.
  const highlight = useMemo(() => {
    const ins = data?.insights
    if (!ins) return null
    if (focus === 'path') return new Set(ins.longest_path[0]?.ids ?? [])
    if (focus === 'fronts') return new Set(ins.summary.new_fronts.map((f) => f.id))
    if (focus === 'fastest' && ins.fastest[0]) return new Set([ins.fastest[0].from, ins.fastest[0].to])
    if (focus === 'hub' && ins.hubs[0]) {
      // The hub and everything that descends from it.
      const kids = new Map<string, string[]>()
      for (const r of data.rels) if (r.type === 'SPREAD_TO') kids.set(r.from, [...(kids.get(r.from) ?? []), r.to])
      const out = new Set<string>()
      const walk = (id: string) => {
        out.add(id)
        for (const k of kids.get(id) ?? []) if (!out.has(k)) walk(k)
      }
      walk(ins.hubs[0].id)
      return out
    }
    return null
  }, [focus, data])

  const { nodes, rels } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], rels: [] as Relationship[] }
    const keep = (k: GNode['kind']) => k === 'Detection' || (k === 'FireDay' ? layers.days : layers.sites)
    const visible = new Set(data.nodes.filter((n) => keep(n.kind)).map((n) => n.id))
    const dim = (id: string) => highlight !== null && !highlight.has(id)
    const nodes: Node[] = data.nodes
      .filter((n) => visible.has(n.id))
      .map((n) => {
        if (n.kind === 'FireDay') {
          const rain = (n.hours ?? 0) >= 2
          return {
            id: n.id,
            size: 34,
            color: rain ? RAIN : BONE,
            caption: `${n.at?.slice(5)}${rain ? ` · rain ${n.hours} mm` : ''}`,
            disabled: highlight !== null,
          }
        }
        if (n.kind === 'Site') return { id: n.id, size: 16, color: LIME, caption: 'Jev site', disabled: highlight !== null }
        const hours = n.hours ?? 0
        return {
          id: n.id,
          size: 6 + Math.min(18, Math.sqrt(n.frp ?? 1) * 3),
          color: fireColor(hours),
          disabled: dim(n.id),
          selected: highlight?.has(n.id) ?? false,
        }
      })
    const rels: Relationship[] = data.rels
      .filter((r) => visible.has(r.from) && visible.has(r.to))
      .map((r, i) => {
        const on = highlight === null || (highlight.has(r.from) && highlight.has(r.to))
        const base = { id: `r${i}`, from: r.from, to: r.to, disabled: !on }
        if (r.type === 'SPREAD_TO') return { ...base, color: '#ff8a1f', width: on && highlight ? 4 : 2 }
        if (r.type === 'NEXT') return { ...base, color: BONE, width: 4 }
        if (r.type === 'SEEN_AT') return { ...base, color: LIME, width: 1 }
        return { ...base, color: IRON, width: 1 }
      })
    return { nodes, rels }
  }, [data, layers, highlight])

  const ins = data?.insights
  const path = ins?.longest_path[0]
  const hub = ins?.hubs[0]
  const fast = ins?.fastest[0]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas sm:flex-row">
      <div className="relative min-w-0 flex-1">
        {data && (
          <InteractiveNvlWrapper
            nodes={nodes}
            rels={rels}
            nvlOptions={{ layout: 'forceDirected', disableTelemetry: true, renderer: 'canvas', initialZoom: 0.38, styling: { disabledItemColor: '#26271f', disabledItemFontColor: ASH } }}
            mouseEventCallbacks={{
              onNodeClick: (n: Node) => setPicked(data.nodes.find((x) => x.id === n.id) ?? null),
              onCanvasClick: () => setPicked(null),
              onPan: true,
              onZoomAndPan: true,
              onDrag: true,
            }}
          />
        )}
        {!data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-4 font-mono text-[13px] uppercase tracking-wider text-bone">
              {error ? (
                `Graph failed: ${error}`
              ) : (
                <>
                  <span className="size-6 animate-spin rounded-[50%] border-2 border-iron border-t-lime" />
                  Writing the propagation graph to Neo4j…
                </>
              )}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute left-3 right-3 top-3 bg-canvas/80 px-4 py-3 backdrop-blur-sm sm:left-6 sm:right-auto sm:top-6 sm:px-5 sm:py-4">
          <div className="text-[32px] sm:text-[56px] font-normal leading-[0.95] tracking-[-0.03em] text-bone">Fire graph</div>
          <div className="mt-1 font-mono text-[13px] uppercase tracking-wider text-ash">
            {name} · propagation graph in Neo4j{data ? ` · ${data.nodes.length} nodes · ${data.rels.length} relationships` : ''}
          </div>
        </div>

        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-x-4 gap-y-1 bg-canvas/85 sm:bottom-6 sm:left-6 sm:right-auto px-3 py-2 font-mono text-[12px] uppercase tracking-wider text-ash backdrop-blur-sm">
          <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[#ffd000]" />first hours</span>
          <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[#8b1010]" />days later</span>
          <span className="inline-flex items-center gap-2"><i className="h-[2px] w-4 bg-[#ff8a1f]" />spread_to</span>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={layers.days} onChange={(e) => setLayers((l) => ({ ...l, days: e.target.checked }))} className="accent-lime" />
            days
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={layers.sites} onChange={(e) => setLayers((l) => ({ ...l, sites: e.target.checked }))} className="accent-lime" />
            Jev memory sites
          </label>
        </div>
      </div>

      <aside className="flex h-[45%] w-full shrink-0 flex-col border-t border-iron sm:h-auto sm:w-[420px] sm:border-l sm:border-t-0">
        <div className="flex items-center justify-between border-b border-iron px-5 py-4 font-mono text-[12px] uppercase tracking-wider text-ash">
          <span>What the graph tells us</span>
          <button type="button" onClick={onClose} className="flex items-center gap-2 text-bone hover:text-lime">
            <X size={16} /> Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {ins && (
            <>
              <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
                <Stat label="Detections" value={ins.summary.detections} />
                <Stat label="Spread links" value={ins.summary.spread_links} />
                <Stat label="Jev sites" value={ins.jev_sites[0]?.sites ?? 0} />
              </div>
              <Insight
                active={focus === 'path'}
                onClick={() => setFocus(focus === 'path' ? 'none' : 'path')}
                title="Longest spread path"
                text={path ? `${path.hops} hops, ${path.km} km from where it started, over ${Math.round(path.to_h - path.from_h)} h.` : '—'}
              />
              <Insight
                active={focus === 'hub'}
                onClick={() => setFocus(focus === 'hub' ? 'none' : 'hub')}
                title="Key spreading point"
                text={hub ? `${hub.descendants} later detections descend from one point seen at +${hub.hours} h: holding it early would have cut the fire's main branch.` : '—'}
              />
              <Insight
                active={focus === 'fronts'}
                onClick={() => setFocus(focus === 'fronts' ? 'none' : 'fronts')}
                title="New fronts"
                text={
                  ins.summary.new_fronts.length
                    ? `${ins.summary.new_fronts.length} detections had no earlier fire within 2 km (at ${ins.summary.new_fronts.map((f) => `+${Math.round(f.hours)} h`).join(', ')}): jumps or spotting ahead of the front.`
                    : 'Every detection connects to an earlier one: a single continuous front.'
                }
              />
              <Insight
                active={focus === 'fastest'}
                onClick={() => setFocus(focus === 'fastest' ? 'none' : 'fastest')}
                title="Fastest run"
                text={fast ? `${fast.km} km in ${fast.hours} h (${fast.km_h} km/h) between two satellite passes.` : '—'}
              />
              <div className="pt-2">
                <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ash">Day by day</div>
                <div className="space-y-1 font-mono text-[12px] tabular-nums">
                  {ins.per_day.map((d) => (
                    <div key={d.date} className="flex justify-between gap-2 text-bone">
                      <span className="text-ash">{d.date.slice(5)}</span>
                      <span>{d.detections} det</span>
                      <span>{d.spread_links} spread</span>
                      <span className={d.rain_mm >= 2 ? 'text-[#6cb6ff]' : 'text-ash'}>{d.rain_mm} mm</span>
                    </div>
                  ))}
                </div>
              </div>
              {picked && (
                <div className="border border-iron p-3 font-mono text-[12px] text-bone">
                  <div className="mb-1 uppercase tracking-wider text-ash">{picked.kind}</div>
                  {picked.kind === 'Detection' && (
                    <div>
                      +{picked.hours} h · FRP {picked.frp} MW · {picked.satellite}
                      <br />
                      {picked.lat?.toFixed(4)}, {picked.lon?.toFixed(4)}
                    </div>
                  )}
                  {picked.kind === 'FireDay' && <div>{picked.at} · rain {picked.hours} mm</div>}
                  {picked.kind === 'Site' && <div>{picked.satellite} · judged by Jev, stored in agent memory</div>}
                </div>
              )}
              <details className="pt-2">
                <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-ash">How SPREAD_TO is computed (Cypher)</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ash">{data?.cypher.spread}</pre>
              </details>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ash">{label}</div>
      <div className="text-[26px] font-light leading-none text-bone">{value}</div>
    </div>
  )
}

function Insight({ title, text, active, onClick }: { title: string; text: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full border-l-2 py-1 pl-3 text-left ${active ? 'border-lime' : 'border-iron hover:border-bone'}`}
    >
      <div className={`text-[14px] ${active ? 'text-lime' : 'text-bone'}`}>{title}</div>
      <div className="text-[13px] leading-snug text-ash">{text}</div>
    </button>
  )
}
