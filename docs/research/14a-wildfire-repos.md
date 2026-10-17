# 14a — Wildfire repos to learn from

Snapshot date: 2026-10-17. Stars and push dates come from `gh repo view` / `gh api` unless noted. "Unverified" means I could not confirm it from primary material.

## 1. FranprzDev/donde-arde-argentina

Source: https://github.com/FranprzDev/donde-arde-argentina (README, `docs/`, `pipeline/prep_data.py` read via `gh api`).

| Field | Finding |
| --- | --- |
| What it does | A data-viz **video** (59.5 s, 1920×1080) on fire hotspots and burned area in Argentina, 2012–2025. Not a web app; the map is rendered into video frames. [README](https://github.com/FranprzDev/donde-arde-argentina#readme) |
| Stack | Canonical pipeline is an all-Rust harness (`harness-rs/`, crate `datavid`, "fframes"). Older Python pipeline (`pipeline/`, v2–v9) and generic Python harness (`harness/`) kept for reference. GitHub reports Python as primary language. |
| Stars / activity | 0 stars, not archived, last push 2026-10-14. License: code MIT (per README); derived data follows each source's license. |
| FIRMS usage | Yes. VIIRS S-NPP 375 m, yearly per-country archive: `https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/{YEAR}/viirs-snpp_{YEAR}_Argentina.csv`. Filter `type == 0` and `confidence ∈ {n, h}` → 2,550,467 hotspots. Source: [docs/sources.md](https://github.com/FranprzDev/donde-arde-argentina/blob/main/docs/sources.md). |
| Other sources | MODIS MCD64A1 C6.1 burned area (UMD); Ministry of Environment fire causes 1993–2019; INDEC/IGN boundaries; EEAOC sugarcane table; Copernicus Sentinel-2 L2A. Listed in [README](https://github.com/FranprzDev/donde-arde-argentina#data-sources). |
| Map rendering | Rust harness renders frames; no interactive map in the repo. |
| Fire-spread / risk logic | **None found.** The methodology doc ([descripcion-metodologica.md](https://github.com/FranprzDev/donde-arde-argentina/blob/main/docs/descripcion-metodologica.md)) describes counts and burned area, not spread. |
| Reusable | (a) The FIRMS country-archive URL pattern and the `type==0` + confidence filter. (b) The "no hand-typed number" rule: on-screen numbers come from named facts, verbal roundings have `[[assert]]`s, and `docs/sources.md` verifies every figure. This maps well to our triage numbers. (c) Chunked, resumable render scripts if we ever ship a video. |

## 2. Other projects

| # | Project | URL | Stars | Last push | License | Stack | What we could borrow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | FireSight (zelinewang) | https://github.com/zelinewang/FireSight | 0 | 2026-07-13 | MIT | Vanilla JS, Leaflet, Netlify; FIRMS MODIS + VIIRS NOAA-20 24 h CSV | Client-side FIRMS ingest, dedupe within ~1 km across MODIS/VIIRS, confidence tiers, and an honest "spread is a heuristic, not a model" disclaimer. Only permissive, browser-only option in this list. |
| 2 | ha-nasa-firms (bangboomben) | https://github.com/bangboomben/ha-nasa-firms | 5 | 2026-10-04 | MIT | Python (Home Assistant integration) | Multi-satellite dedupe, confidence/FRP filters, proximity alerts, "wind at the fire" idea (wind drift per fire). Alert logic is directly relevant to "raise alert only when it matters". |
| 3 | fire-map (kjaymiller) | https://github.com/kjaymiller/fire-map | 5 | 2026-08-21 | none listed (all rights reserved by default) | FastAPI, Postgres, Valkey, Docker Compose | Append-only Postgres history of every FIRMS reload plus a TTL'd "current snapshot" cache. Pattern matches our detection history in Neo4j. Cannot copy code without a license. |
| 4 | NASA Orbital Thermal Dashboard (NukGod-V) | https://github.com/NukGod-V/forest-fire-dashboard_v2 | 1 | 2026-06-06 | none listed | React, Vite, Deck.gl, MapLibre, Chart.js, Azure Functions | WebGL rendering of thousands of FIRMS points with Deck.gl; a fit for the map UI if we need many points. Readme covers India, not Japan. |
| 5 | wildfire-gis-fastapi (jakimovskidrago123-pixel) | https://github.com/jakimovskidrago123-pixel/wildfire-gis-fastapi | 0 | 2025-11-06 | none listed | FastAPI, Leaflet | FastAPI backend plus spatial analytics over FIRMS detections. Architecture reference only. |
| 6 | LINTAR (didarisme) | https://github.com/didarisme/LINTAR · demo: https://whilefalse.itch.io/lintar | 0 | 2026-06-24 | none listed | Unity (C#), WebGL build | 3D replay of fire spread over real terrain, with burnt area kept visible and thousands of fire sources on GPU. Says it takes NetLogo simulation output, not FIRMS. Best reference for a "fire unfolds in 3D" view. |
| 7 | Data-Driven Wildfire Spread Modeling, Rigoto 2026 (thesis) | https://marcelorigoto1.github.io/github-portifolio/thesis/index.html · repo https://github.com/marcelorigoto1/github-portifolio | 0 (repo) | 2026-10-12 | "Other" on the repo | Unity3D, Cesium elevation, FIRMS | Closest match to our brief: FIRMS hotspots draped on Cesium terrain, markers sized by FRP, a day-by-day timeline you can scrub, and a browser build. Its user study (68 participants) found terrain matters most for comprehension. **Unverified:** I read only the thesis landing page, not the code. |
| 8 | GaioCode Wildfire-Simulation | https://github.com/GaioCode/Wildfire-Simulation | 0 | 2025-12-17 | none | Unity (GitHub lists Mathematica and C#) | 3D fire-spread dynamics and heatmap visualization. Simulation, not real data. Low priority. |
| 9 | FireTrace (jtpotato) | https://github.com/jtpotato/firetrace | 3 | 2024-02-11 (last push) | MIT | Python | Continental bushfire modelling for Australia. Not FIRMS-based as far as I checked (unverified). Only useful as a spread-model reference. |
| 10 | wildfire-tracker (alaibamasood-svg) | https://github.com/alaibamasood-svg/wildfire-tracker | 0 | 2026-08-25 | none listed | Python (README) | Distance from a saved location to FIRMS detections. Trivial proximity logic, reference only. |

Other FIRMS and dashboard repos found in search (lower relevance, not analyzed): `oscr104/FirmWare`, `Crane-lupert/firms_wildfire_utility_xs`, `tfasoli2020/nasa-environmental-exposure-risk-dashboard` (MIT, Dixie Fire exposure, Jupyter), `xops-labs/ClimateRiskIQ` (Apache-2.0, C#, FIRMS as a hazard input).

## 3. Projects in Japan or using Japanese data

**None found.** My searches for "Japan wildfire satellite", "Himawari wildfire", and Japanese keyword queries returned unrelated pages. The GitHub repo searches for "FIRMS japan" and "Japan fire hotspot satellite" returned nothing relevant. This is a search-coverage gap, not proof that none exist. Unverified: whether FIRMS publishes a Japan country archive in the same URL pattern as Argentina.

## Top 3 to borrow from today (1-day hackathon)

1. **donde-arde-argentina: FIRMS archive filter and fact-verification rule.** Concrete and immediately usable: the country-archive CSV pattern, `type==0` plus `confidence ∈ {n,h}`, and the "every on-screen number comes from a named fact" discipline. This tightens our hotspot ingest and makes our report numbers auditable in the demo. It is MIT (code), so we can copy the pattern.
2. **FireSight (MIT).** A working FIRMS to Leaflet pipeline with MODIS/VIIRS dedupe and confidence tiers, plus the honest "spread is a heuristic" framing. We can lift the parsing and tier logic into our map UI in an hour and state the limits on screen, which judges tend to reward.
3. **Rigoto thesis (concept only).** FIRMS points draped on terrain, FRP-scaled markers, and a day timeline you can scrub is the 3D and timeline story we lack. Its user study also gives a sourced reason to add terrain. Borrow the concept, not code, until its repository is inspected. If we have time, LINTAR is a visual reference only, since it has no license listed.

Not in the top 3: fire-map (good history model, but no license) and the Deck.gl dashboard (useful if we hit rendering limits).
