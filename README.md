# Wildfire Sentinel

NASA flags hundreds of heat sources over Japan every day, and most of them are steel mills and factories. Wildfire Sentinel sorts them out. Jev triages each hotspot in about 0.2 s and raises an alert immediately. A second Jev fan-out probes each alert. ai& writes a situation report for a municipal officer. Neo4j Agent Memory remembers sites and verdicts, so known industrial sites are skipped on the next pass.

## The problem

Satellite hotspot feeds are noisy. Most detections over Japan come from industrial sites, and an officer cannot review every one. The system has to alert on possible fires at once, then explain the situation in enough detail to act on.

## How it works

1. **FIRMS** returns hotspots, either live (today) or from the archive (replay).
2. **Memory check** (`search_locations_near`): a known industrial site is filtered out with no model call.
3. **Stage 1, Jev sentinel**: one cheap request per hotspot on the GSI aerial photo. It asks about industrial facilities within about 400 m, vegetation, and houses. A possible fire is alerted immediately.
4. **Stage 2, Jev deep probe**: only for alerted hotspots. Several images and many questions run in parallel (fuel, vegetation continuity, settlement direction, firebreaks, smoke, and similar).
5. **Rule-based scoring** combines Jev answers, weather (Open-Meteo wind, humidity, days without rain) and FIRMS (FRP, detections, trend) into danger, spread risk, exposure and urgency. The weights are in code.
6. **ai& report**: writes the headline, brief (JA/EN), confidence, key evidence and unknowns from the structured findings. Times and numbers come from code, never from the model.
7. **Neo4j memory** stores each site, each verdict as a reasoning trace, and the detection history.
8. **Map UI** shows hotspots colored by verdict. Clicking one shows photos, probe answers, scores, the memory trace and the report.

Recommended actions are rule-based. For example, evacuation advice appears only when houses are within reach and danger is 4 or higher.

## Sponsor tools and how we use them

**ai&** (OpenAI-compatible API at `https://api.aiand.com/v1`)
- `deepseek-ai/deepseek-v4-flash` writes the situation report with a strict JSON schema.
- `zai-org/glm-5.3-flash` is the vision model. It was verified in the spike but is not on the main path.
- The report takes about 5–11 s per alert.

**Neo4j** (neo4j-agent-memory 0.7.0)
- Each verdict is a reasoning trace with its tool calls recorded.
- Sites are `LOCATION` entities with coordinates. `search_locations_near` lets the pipeline skip known industrial sites.
- Local Neo4j 5.26 runs in Docker. Aura can be used through environment variables.

**TypeSafe Jev** (not a sponsor tool) is the fast System One model used for stage 1 and stage 2. Spike model: `jev-1.14.0`.

## Measured results

| Measurement | Result | Source |
| --- | --- | --- |
| Jev triage, one site | 150–300 ms | spike, `docs/10-integrations.md` |
| Jev triage, 71 sites | 5.6 s | spike, `docs/10-integrations.md` |
| FIRMS, Japan bbox, 2 days | 155 detections | spike, `docs/10-integrations.md` |
| Jev deep probe, 11 questions across 3 images | 190–530 ms | end-to-end replay run |
| Live run, share filtered as industrial | 77% (55 of 71 sites) | `docs/12-product-design.md` |
| ai& situation report | 5–11 s (text model; vision model was 20–47 s) | end-to-end run, `odd/tasks/wildfire-sentinel.md` |
| Ofunato replay (2025-02-26 to 03-01) | 48 hotspots, 37 Jev calls, 3–4 ai& reports, about 23 s | end-to-end run, `odd/tasks/wildfire-sentinel.md` |
| Memory, second pass over the same area | 100% memory hits, 0 Jev calls | spike, `docs/10-integrations.md` |

## Run it

Requirements: Docker, [uv](https://docs.astral.sh/uv/), and API keys.

```bash
# 1. Start local Neo4j (repo root)
docker compose up -d

# 2. Configure keys
cp .env.example .env
# Fill in TYPESAFE_API_KEY, AIAND_API_KEY and MAP_KEYS (NASA FIRMS).
# Neo4j variables are optional: they are used only when NEO4J_URI, NEO4J_USERNAME and
# NEO4J_PASSWORD are all set; otherwise the app uses the local Docker instance.
# The FIRMS key may be named MAP_KEYS or FIRMS_MAP_KEY.

# 3. Start the server
cd app && uv run uvicorn sentinel.server:app --port 8000
```

Open http://localhost:8000 and choose a mode:
- **Live · today** runs on today's FIRMS data.
- **Replay · Ofunato 2025** runs on the FIRMS archive for 2025-02-26 to 2025-03-01.

Mock UI, without the backend: serve `web/` and open `index.html?mock=1`.

Tests: `cd app && uv run pytest`

## Repository layout

```
app/sentinel/      Python backend (FastAPI, pipeline, models, memory)
  __init__.py      package marker
  config.py        keys and settings from .env; local Neo4j fallback
  sources.py       FIRMS hotspots, GSI mosaics, GIBS satellite tiles, Open-Meteo weather
  jev.py           Jev stage 1 (sentinel) and stage 2 (deep probe)
  questions.py     Jev question sets for stage 1 and stage 2
  memory.py        Neo4j Agent Memory: sites, verdicts, history
  scoring.py       deterministic scores, classification and recommended actions
  analyst.py       ai& situation report from structured findings
  pipeline.py      orchestration and event stream
  server.py        FastAPI: SSE run endpoint, cached images, static UI
app/tests/         pytest suite (scoring rules)
web/               single-page map UI (index.html, app.js, styles.css, mock-events.json)
docs/              design notes, integration reference, Neo4j brief
spike/             standalone spike scripts for each service
docker-compose.yml local Neo4j 5.26 with APOC
```

## Data sources and attribution

- **NASA FIRMS**: active fire hotspots (VIIRS NOAA-20, near real time and archive).
- **NASA GIBS**: satellite true-color imagery.
- **GSI aerial photos**: 出典：国土地理院 (Geospatial Information Authority of Japan).
- **Open-Meteo**: weather (wind, gusts, humidity, precipitation).

## Limitations

- Replay uses archived data. It does not show a live event.
- GSI photos are archival, not real-time.
- VIIRS geolocation is about 375 m, so the pipeline asks about industrial sites within about 400 m of the hotspot rather than at its exact center.
- Images in Jev are a beta feature.
- Scores come from heuristic rules and are not calibrated against real fire outcomes.
- Memory uses a local sentence-transformers embedding model, because ai& has no embeddings endpoint.
- The Aura Free instance auto-pauses after 72 hours of inactivity.
