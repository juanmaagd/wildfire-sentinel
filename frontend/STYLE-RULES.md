# Style rules (apply mechanically) — derived from DESIGN.md

Tokens already defined in `src/index.css`: `canvas` #13140e, `bone` #f4f3e8, `iron` #404040, `ash` #84837b, `lime` #ebfc72, `olive` #bacd31; fonts `font-sans` (Inter), `font-mono` (JetBrains Mono), `font-jp`.

## Replace

| Find | Replace with |
| --- | --- |
| any `shadow-*` | remove |
| `rounded-sm/md/lg/xl/2xl/3xl/full` on buttons, tags, inputs, badges | `rounded-[3.6px]` |
| `rounded-*` on panels, cards, drawers, sections | remove (0 radius) |
| `bg-zinc-*`, `bg-neutral-*`, `bg-gray-*`, `bg-slate-*`, `bg-stone-*`, `bg-black` on surfaces | `bg-canvas` (or `bg-canvas/80 backdrop-blur-sm` only for UI floating over a map) |
| card-like boxes (`bg-*` + `border` + `rounded`) | no fill; separate with `border-t border-iron` hairlines or spacing |
| `text-white`, `text-zinc-100/200` | `text-bone` |
| `text-zinc-400/500`, `text-gray-400/500`, `text-neutral-400/500` | `text-ash` |
| `border-zinc-*`, `border-neutral-*`, `border-gray-*`, `border-white/*` | `border-iron` |
| red/orange/amber/yellow/rose classes in UI chrome (buttons, badges, tags, KPI numbers, headers, selected states) | lime equivalents: `bg-lime text-canvas`, `text-lime`, `border-lime` |
| `font-semibold`/`font-bold` on Inter text | `font-normal` (display weight is 400) |

## Typography roles

- Every label, button text, tag, coordinate, number, latency, timestamp, KPI, feed line, section title: `font-mono`. Section titles: `font-mono text-[13px] uppercase tracking-wider text-ash`.
- KPI numerals: `font-mono font-light text-[44px] leading-none text-bone` (the alerts KPI: `text-lime`).
- Editorial headline (alert headline, 3D view title): `font-sans font-normal text-[40px] leading-[0.95] tracking-[-0.03em] text-bone` (72px if the space allows, e.g. the 3D view title).
- Body text (brief, situation, evidence): `font-sans text-[16px] leading-[1.6] text-bone`; Japanese text adds `font-jp`.

## Components

- Primary button: `bg-lime text-canvas font-mono text-[13px] uppercase tracking-wider px-[18px] py-[12px] rounded-[3.6px] hover:bg-olive`.
- Secondary/ghost button: `border border-iron text-bone font-mono text-[13px] uppercase tracking-wider px-[14px] py-[10px] rounded-[3.6px] hover:border-bone`; active/pressed state: `border-lime text-lime`.
- Data tag / badge: `bg-lime text-canvas font-mono text-[12px] uppercase px-[7px] py-[4px] rounded-[3.6px]`; outline variant: `border border-lime text-lime`.
- Urgency badge (1–5): mono numeral in a 28px square: urgency ≥4 `bg-lime text-canvas`, 3 `border border-lime text-lime`, ≤2 `border border-iron text-ash`.
- Probability/score bars: track `bg-iron h-[3px]`, fill `bg-lime` (no rounded ends).
- Memory badge: outline lime tag with text `MEMORY`.
- Selected list item: `border-l-2 border-lime bg-bone/5`; others `border-l-2 border-transparent`.
- Dividers: `border-iron` 1px only.

## Do not change

Logic, props, state, data flow, event handling, MapLibre layer data, fire colors inside map layers (the yellow→orange→red ramp and pulsing fire markers on the maps stay as they are), file names, exports.
