# Wildfire Sentinel — feature document

Objective: hackathon product (deadline 16:00 JST, 2026-10-17). Jev raises wildfire alerts immediately from FIRMS hotspots + GSI aerial photos, fans out a deep probe on alerts, code scores, ai& writes the situation report, Neo4j Agent Memory remembers sites and verdicts. Map UI with live + replay modes.
Branch: `feat/wildfire-sentinel` · Delivery: single-pr (hackathon) · Test runner: `uv run pytest` (in `app/`) · Design: `docs/12-product-design.md`.

## Specs

- **S1** Immediate alert: "lo que me importa es que se alerte inmediato de un incendio o posible foco sabes, no apalancamos de jev que es extremadamente rapido y economico". Stage 1 = one Jev request per hotspot; a possible fire is emitted to the UI as soon as its verdict exists.
- **S2** Deep probe: "luego si detectamos un posible foco podemos hacer mas llamadas para diferentes puntos de analisis asi es como funciona jev". Stage 2 = Jev fan-out (several images, many questions) only for alerted hotspots.
- **S3** Situation report: "jev lanza la alerta y luego con aiand analizamos en detalle que es lo que ocurre y generamos un informe de la situacion, con diferentes parametros, urgencia, peligrosidad, no se cosas como esa y un brief". ai& report with urgency, danger, spread risk, exposure, confidence, evidence, unknowns, brief JA/EN. Numbers and times come from code, never the model.
- **S4** Memory: Neo4j Agent Memory stores sites, verdicts as reasoning traces, detection history; known industrial sites skip Jev.
- **S5** Demo modes: live (today's FIRMS) and replay (Ofunato, 2025-02-26 → 2025-03-01, FIRMS archive).
- **S6** Map UI: single page, hotspots appear live colored by verdict; click → photos, probe answers, scores, memory trace, report.
- **S8** 3D spread view: "si somos capaces de generar una simulacion didactica y prediccion basandonos en el clima, terreno, etc, seria espectacular ... pasarle un punto en un mapa y generartelo en 3d". Presented as a spread prediction (user: "tenemos que vender humo"). MapLibre 5.6.2 terrain (AWS terrarium DEM + GSI photo), perimeters +1h/+3h/+6h from wind/slope/fuel.
- **S7** Recommended actions are rule-based in code (assumption: evacuation advice only if houses are within reach and danger ≥ 4).

## Tasks

| ID | Specs | Task | Route | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| T1 | S1,S5 | Sources: FIRMS (live + archive), GSI mosaics (z16, z14), Open-Meteo weather, satellite tile | inline | done | 3f1efac |
| T2 | S1,S4 | Stage 1 sentinel (Jev) + memory filter | inline | done | 3f1efac |
| T3 | S2 | Stage 2 deep probe (Jev fan-out), validated on Ofunato replay | inline | done | 3f1efac |
| T4 | S3,S7 | Composite scoring + action rules (pure, tested) | inline | done (20 tests green) | 3f1efac |
| T5 | S3 | ai& analyst report (strict JSON) | inline | done | 3f1efac |
| T6 | S1,S5 | Pipeline + FastAPI SSE (`/api/run?mode=live|replay`) | inline | done | 3f1efac |
| T7 | S6 | Map UI (`web/`) against the event contract below | delegated (parallel unit, disjoint surface `web/`) | done (worker; verified mock + real backend) | 3f1efac |
| T8 | — | README, submission text, rehearsal, backup recording | delegated (Haiku) + inline | README+pitch done, rehearsal/recording todo | 50f9324 |
| T9 | S8 | Spread model `spread.py` + `GET /api/spread?lat=&lon=&day=&fuel=` | inline | done (Ofunato d1: 16/140/421 ha at +1/3/6 h, ~2.8 s) | 75c5311 |
| T10 | S8 | 3D view in UI (MapLibre) | delegated (parallel unit, `web/`) | todo | |

## Event contract (SSE, `GET /api/run?mode=live|replay`)

- `hotspot` `{id, lat, lon, frp, acq_date, acq_time, detections}`
- `triage` `{id, verdict: possible_fire|industrial|water|other, source: jev|memory, confidence, signals: {industrial_nearby, vegetation_nearby, houses_nearby}, latency_ms, image_url}`
- `probe` `{id, answers: {<question_id>: {value, confidence|probability}}, latency_ms, images: {close, wide, satellite}}`
- `report` `{id, scores: {danger, spread_risk, exposure, urgency}, confidence, headline_ja, headline_en, brief_ja, brief_en, key_evidence[], unknowns[], recommended_actions[], weather: {...}, generated_at}`
- `summary` `{mode, total, in_japan, filtered_industrial, memory_hits, alerts, jev_calls, elapsed_s}`
- `done` `{}`
- Images: `GET /api/images/{name}`.

## Log

- **L1** (2026-10-17, user, verbatim): "Si está bien por ahora, lo que me importa es que se alerte inmediato de un incendio o posible foco sabes, no apalancamos de jev que es extremadamente rapido y economico, luego si detectamos un posible foco podemos hacer mas llamadas para diferentes puntos de analisis asi es como funciona jev sabes lo que quiero decir"
- **L2** (earlier, user, verbatim): "Podemos usar aiand no solo de fallback sino que jev lanza la alerta y luego con aiand analizamos en detalle que es lo que ocurre y generamos un informe de la situacion, con diferentes parametros, urgencia, peligrosidad, no se cosas como esa y un brief"
- **L3** Evidence from spikes (`spike/`, `docs/09`, `docs/10`, `docs/11`): all integrations verified; Jev 71 sites in 5.6 s; ask "industrial within ~400 m" due to VIIRS ~375 m geolocation; Ofunato archive = 103 detections.
- **L4** (user, verbatim): "cabe aclarar que no haremos muchos tests, los minimos posibles, neceistamos velocidad de ejecucion sin enredarnos esto no debe ser escalable, buscamos velocidad de accion"
- **L5** Verified end to end: Ofunato replay 48 hotspots, 37 Jev calls, 3-4 ai& reports in ~23 s; UI renders alerts, report JA/EN. Fixes: Neo4j deadlock (serialized memory writes), embedding warmup at startup, reports in background, text model for reports (5-11 s vs 20-47 s vision), replay forgets Ofunato area first.
- **L6** (user, verbatim): "si somos capaces de generar una simulacion didactica y prediccion basandonos en el clima, terreno, etc, seria espectacular, podemos emplear alguna libreria threejs o no se cual ... debemos investigarlo antes de hacer cualquier cosa"; later: "tenemos que vender humo nadie nos a juzgar ni retarnos". Research in docs/research/14a-c; MapLibre terrain prototype verified (web/terrain-test.html).
