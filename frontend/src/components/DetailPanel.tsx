import { useState, type ReactNode } from 'react'
import Lightbox from './Lightbox'
import { Globe2, Share2 } from 'lucide-react'
import type { Lang, Report, Signal, Site } from '../types'
import { fmtAcq, fmtDateTime, humanize, ms, num, siteCoord, verdictLabel } from '../lib/format'

interface Props {
  site: Site | undefined
  lang: Lang
  setLang: (l: Lang) => void
  badImages: Set<string>
  onBadImage: (url: string) => void
  onOpen3D: () => void
  onOpenGraph?: () => void
  onRequestReport: () => void
  reportLoading: boolean
  probeState?: string // 'loading' | 'done' | 'error: …'
  onRetryProbe?: () => void
}

const Section = ({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) => (
  <section className="border-t border-iron pt-4">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h4 className="font-mono text-[13px] uppercase tracking-wider text-ash">{title}</h4>
      {right && <span className="font-mono text-sm text-ash">{right}</span>}
    </div>
    {children}
  </section>
)

function Pips({ value }: { value: number }) {
  const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)))
  return (
    <div className="mt-2 flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={`h-[3px] flex-1 ${i <= n ? 'bg-lime' : 'bg-iron'}`} />
      ))}
    </div>
  )
}


// Normalizes {value, probability|confidence} | number | boolean | string into a display row.
function normalize(a: unknown): { value: string; p: number | null } {
  let value: unknown = a
  let p: number | null = null
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const o = a as Signal & { answer?: unknown }
    value = 'value' in o ? o.value : o.answer ?? ''
    p = typeof o.probability === 'number' ? o.probability : typeof o.confidence === 'number' ? o.confidence : null
  } else if (typeof a === 'number' && a >= 0 && a <= 1) {
    p = a
    value = a >= 0.5 ? 'yes' : 'no'
  }
  if (typeof value === 'boolean') value = value ? 'yes' : 'no'
  if (Array.isArray(value)) value = value.join(', ')
  if (value && typeof value === 'object') value = JSON.stringify(value)
  return { value: String(value ?? ''), p: p == null ? null : Math.max(0, Math.min(1, p)) }
}

function AnswerRow({ k, a }: { k: string; a: unknown }) {
  const { value, p } = normalize(a)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-x-3 gap-y-1 py-2">
      <span className="truncate font-mono text-[13px] text-ash" title={k}>{humanize(k)}</span>
      <span className="truncate text-right font-sans text-[16px] leading-[1.6] text-bone" title={value}>{value}</span>
      {p != null && (
        <div className="col-span-2 flex items-center gap-3">
          <span className="h-[3px] flex-1 overflow-hidden bg-iron">
            <i className="block h-full bg-lime" style={{ width: `${(p * 100).toFixed(0)}%` }} />
          </span>
          <span className="w-10 text-right font-mono text-sm tabular-nums text-ash">{p.toFixed(2)}</span>
        </div>
      )}
    </div>
  )
}

const List = ({ items }: { items?: string[] }) => (
  <ul className="space-y-1.5 font-sans text-[16px] leading-[1.6] text-bone">
    {(items ?? []).map((x, i) => (
      <li key={i} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 bg-ash" />{x}</li>
    ))}
  </ul>
)

const SCORE_ITEMS: [keyof Report['scores'], string][] = [
  ['urgency', 'Urgency'],
  ['danger', 'Danger'],
  ['spread_risk', 'Spread risk'],
  ['exposure', 'Exposure'],
]

export default function DetailPanel({ site, lang, setLang, badImages, onBadImage, onOpen3D, onOpenGraph, onRequestReport, reportLoading, probeState, onRetryProbe }: Props) {
  const [viewer, setViewer] = useState<number | null>(null)
  if (!site) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center font-mono text-[13px] text-ash">
        Select an alert or a marker to see photos, Jev answers and the situation report.
      </div>
    )
  }
  const t = site.triage
  const p = site.probe
  const r = site.report
  const ja = lang === 'ja'
  const written = r && !r.brief_pending
  const headline = (written && ((ja ? r.headline_ja : r.headline_en) || r.headline_en || r.headline_ja)) || (t ? verdictLabel(t.verdict) : 'Hotspot · triaging')
  const brief = written ? (ja ? r.brief_ja : r.brief_en) : undefined

  const imgs: [string, string][] = []
  if (p?.images) {
    const order = ['close', 'wide', 'satellite']
    const labels: Record<string, string> = { close: 'Close · z16', wide: 'Wide · z14', satellite: 'Satellite' }
    for (const k of order) if (p.images[k]) imgs.push([p.images[k], labels[k]])
    for (const k of Object.keys(p.images)) if (!order.includes(k) && p.images[k]) imgs.push([p.images[k], humanize(k)])
  }
  if (t?.image_url && !imgs.some(([u]) => u === t.image_url)) imgs.unshift([t.image_url, 'Aerial · triage'])
  const goodImgs = imgs.filter(([u]) => !badImages.has(u))

  const sig = t?.signals ?? {}
  const when = fmtAcq(site)

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={`font-sans font-normal text-[22px] leading-[1.05] sm:text-[28px] tracking-[-0.03em] text-bone ${ja && written ? 'font-jp' : ''}`}>{headline}</h3>
          <div className="mt-2 font-mono text-sm text-ash">
            {siteCoord(site)}
            {when && ` · ${when}`}
            {site.hotspot?.frp != null && ` · FRP ${num(site.hotspot.frp, 1)} MW`}
            {site.hotspot?.detections != null && ` · ${site.hotspot.detections} detections`}
          </div>
        </div>
        {written && (
          <div role="group" aria-label="Brief language" className="flex shrink-0 gap-2">
            {(['ja', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={`rounded-[3.6px] border px-[14px] py-[10px] font-mono text-[13px] uppercase tracking-wider ${lang === l ? 'border-lime text-lime' : 'border-iron text-bone hover:border-bone'}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {brief && <p className={`font-sans text-[16px] leading-[1.6] text-bone ${ja ? 'font-jp' : ''}`}>{brief}</p>}

      {site.hotspot && t?.verdict === 'possible_fire' && (
        <button
          type="button"
          onClick={onOpen3D}
          className="flex w-full items-center justify-center gap-3 rounded-[3.6px] bg-lime px-[18px] py-[12px] font-mono text-[13px] uppercase tracking-wider text-canvas hover:bg-olive"
        >
          <Globe2 size={22} /> 3D spread prediction
        </button>
      )}

      {site.hotspot && t?.verdict === 'possible_fire' && onOpenGraph && (
        <button
          type="button"
          onClick={onOpenGraph}
          className="flex w-full items-center justify-center gap-3 rounded-[3.6px] border border-iron px-[18px] py-[12px] font-mono text-[13px] uppercase tracking-wider text-bone hover:border-lime hover:text-lime"
        >
          <Share2 size={20} /> Fire graph · Neo4j
        </button>
      )}

      {t?.verdict === 'possible_fire' && !written && (
        <button
          type="button"
          onClick={onRequestReport}
          disabled={reportLoading}
          className="flex w-full items-center justify-center gap-3 rounded-[3.6px] border border-lime px-[18px] py-[12px] font-mono text-[13px] uppercase tracking-wider text-lime hover:bg-lime hover:text-canvas disabled:opacity-60"
        >
          {reportLoading ? 'ai& is writing the situation report…' : 'Generate situation report · ai&'}
        </button>
      )}

      {r?.scores && (
        <Section title={written ? 'Situation report · ai&' : 'Assessment · Jev + rules'} right={written ? ms(r.latency_ms) : undefined}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {SCORE_ITEMS.map(([k, label]) => {
              const v = r.scores[k]
              return (
                <div key={k}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-sm text-ash">{label}</span>
                    <b className="font-mono font-light text-[44px] leading-none text-bone tabular-nums">{v != null ? `${v}/5` : '—'}</b>
                  </div>
                  <Pips value={v} />
                </div>
              )
            })}
          </div>
          {r.confidence != null && (
            <div className="mt-3 flex justify-between font-mono text-[13px]">
              <span className="text-ash">Confidence</span>
              <span className="capitalize text-bone">{typeof r.confidence === 'number' ? r.confidence.toFixed(2) : r.confidence}</span>
            </div>
          )}
        </Section>
      )}

      {r?.recommended_actions && r.recommended_actions.length > 0 && (
        <Section title="Recommended actions">
          <List items={r.recommended_actions} />
        </Section>
      )}

      {goodImgs.length > 0 && (
        <Section title="Imagery">
          <div className="grid grid-cols-3 gap-2">
            {goodImgs.map(([u, label], i) => (
              <figure key={u} className="min-w-0">
                <button type="button" onClick={() => setViewer(i)} className="block w-full overflow-hidden border border-iron hover:border-lime" aria-label={`Open ${label}`}>
                  <img src={u} alt={label} loading="lazy" onError={() => onBadImage(u)} className="aspect-square w-full object-cover" />
                </button>
                <figcaption className="mt-1 truncate font-mono text-[12px] text-ash">{label}</figcaption>
              </figure>
            ))}
          </div>
          {viewer !== null && goodImgs[viewer] && (
            <Lightbox images={goodImgs} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
          )}
        </Section>
      )}

      {t ? (
        <Section
          title={
            <span className="flex items-center gap-2">
              Jev triage · {verdictLabel(t.verdict)}
              {t.source === 'memory' && <MemoryBadge />}
            </span>
          }
          right={`${t.source === 'memory' ? 'memory · ' : 'Jev · '}${ms(t.latency_ms)}`}
        >
          <div className="divide-y divide-iron">
            {t.confidence != null && <AnswerRow k="confidence" a={{ value: t.verdict, probability: t.confidence }} />}
            {Object.keys(sig).map((k) => <AnswerRow key={k} k={k} a={sig[k]} />)}
          </div>
          {t.source === 'memory' && (
            <p className="mt-2 font-mono text-[13px] text-ash">Known site: Neo4j remembered this location; no model call was made.</p>
          )}
        </Section>
      ) : (
        <p className="font-mono text-[13px] text-ash">Waiting for Jev triage…</p>
      )}

      {p?.answers ? (
        <Section title={`Jev deep probe · ${Object.keys(p.answers).length} questions`} right={ms(p.latency_ms)}>
          <div className="divide-y divide-iron">
            {Object.keys(p.answers).map((k) => <AnswerRow key={k} k={k} a={p.answers?.[k]} />)}
          </div>
        </Section>
      ) : t?.verdict === 'possible_fire' ? (
        probeState?.startsWith('error') ? (
          <p className="font-mono text-[13px] text-ash">
            Deep probe failed ({probeState.slice(7)}).{' '}
            <button type="button" onClick={onRetryProbe} className="text-lime underline">
              Retry
            </button>
          </p>
        ) : (
          <p className="flex items-center gap-2 font-mono text-[13px] text-ash">
            <span className="size-3 animate-spin rounded-[50%] border-2 border-iron border-t-lime" />
            Jev deep probe running (3 images, ~10 questions)…
          </p>
        )
      ) : null}

      {r?.weather && Object.keys(r.weather).length > 0 && (
        <Section title="Weather">
          <div className="grid grid-cols-2 gap-2 font-sans text-[16px] leading-[1.6] text-bone">
            {Object.entries(r.weather).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 px-3 py-2">
                <span className="font-mono text-[13px] text-ash">{humanize(k)}</span>
                <b className="font-mono font-normal text-bone">{v && typeof v === 'object' ? JSON.stringify(v) : String(v)}</b>
              </div>
            ))}
          </div>
        </Section>
      )}

      {r?.key_evidence && r.key_evidence.length > 0 && <Section title="Key evidence"><List items={r.key_evidence} /></Section>}
      {r?.unknowns && r.unknowns.length > 0 && <Section title="Unknowns"><List items={r.unknowns} /></Section>}
      {r?.generated_at && <p className="pt-2 font-mono text-[12px] text-ash">Report generated {fmtDateTime(r.generated_at)}{r.model ? ` · ${r.model}` : ''}</p>}
    </div>
  )
}

export function MemoryBadge() {
  return (
    <span className="inline-flex items-center rounded-[3.6px] border border-lime px-[7px] py-[4px] font-mono text-[12px] uppercase text-lime" title="Known site, answered from Neo4j memory — no model call">
      memory
    </span>
  )
}

