# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

One-day hackathon project (Tokyo Agent Hackathon, 2026-10-17, submission 16:00 JST). **Wildfire Sentinel**: NASA FIRMS hotspots over Japan → TypeSafe **Jev** triages each from a GSI aerial photo and alerts immediately → a second Jev fan-out probes alerts → deterministic scoring with weather → **ai&** writes the situation report → **Neo4j Agent Memory** remembers sites and verdicts → live map UI.

The user's priority is speed of action: keep tests minimal (only `app/tests/test_scoring.py`), no abstractions for future cases, verify by running. Sponsor rule: ai& and/or Neo4j must stay load-bearing. Jev is not a sponsor.

## Commands

```bash
docker compose up -d                                   # local Neo4j 5.26 (neo4j / wildfire-local-dev), Browser http://localhost:7474
cd app && uv run uvicorn sentinel.server:app --port 8000   # backend + UI at http://localhost:8000
cd app && uv run pytest                                # scoring rules tests
cd app && uv run pytest tests/test_scoring.py::test_urgency_rises_as_detections_accumulate   # single test
curl -sN "http://localhost:8000/api/run?mode=replay"   # raw SSE stream (mode=live|replay)
```

```bash
cd frontend && npm run build    # React UI → frontend/dist, served by FastAPI at :8000 (no server restart needed after rebuilds)
cd frontend && npm run dev      # Vite dev server :5173, proxies /api → :8000
```

The server serves `frontend/dist` when it exists, otherwise the vanilla fallback UI in `web/`. Both support `?mock=1` (no backend). Keep MapLibre pinned at 5.6.2: v6 ships its worker as an ES module chain that breaks in the Vite production build. Frontend styling follows `frontend/DESIGN.md` through `frontend/STYLE-RULES.md` (Tailwind v4 only; lime is the only UI accent, fire colors only as map data).

Restart uvicorn after backend edits (no reload). The server warms up the embedding model at startup; the first run hangs without it.

## Secrets

Keys live in the repo-root `.env` (loaded by `app/sentinel/config.py`): `TYPESAFE_API_KEY`, `AIAND_API_KEY`, `MAP_KEYS` (NASA FIRMS). Do not read, print or grep `.env` from the shell — the user denies it. Neo4j: `.env` credentials are used only when `NEO4J_URI`, `NEO4J_USERNAME` and `NEO4J_PASSWORD` are all set; otherwise the local Docker instance.

## Architecture (`app/sentinel/`)

- `pipeline.py` — the orchestrator. `Run` emits SSE events (`day`, `hotspot`, `triage`, `probe`, `report`, `summary`, `analysis_error`, `done`) as each step finishes. Stage 1 runs concurrently (semaphore 8); stage 2 + ai& reports run as background tasks so they never block the next batch of alerts. Replay iterates 4 days of the Ofunato fire (2025-02-26) and first forgets that area in memory so Jev is visible in the demo.
- `jev.py` + `questions.py` — Jev calls. Images need the `TypeSafe-Danger-Zone-Images: true` header, model `jev-preview`, **280–1568 px per side**. Stage 1 asks about ~400 m around the center (VIIRS geolocation is ~375 m, never ask about the exact center pixel). Stage 2 sends `close` (z16), `wide` (z14) and `satellite` images in one request.
- `scoring.py` — pure rules: `classify` (stage-1 verdict), `score` (1–5 danger/spread/exposure/urgency from probe + weather + FIRMS), `recommended_actions`. Numbers and actions come from here, never from the LLM.
- `analyst.py` — ai& (OpenAI SDK, `https://api.aiand.com/v1`). Default `deepseek-ai/deepseek-v4-flash` with strict JSON schema (~5–11 s); the vision model is opt-in because it takes 20–47 s. Feed it Jev **labels**, not raw scale numbers, or it invents units.
- `memory.py` — neo4j-agent-memory 0.7.0 with local `sentence_transformers` embeddings (ai& has no embeddings endpoint). Sites are `LOCATION` entities with coordinates; every verdict is a reasoning trace with a tool call. Writes are serialized with a lock (concurrent entity writes deadlock in Neo4j).
- `spread.py` — fire spread prediction: elliptical wind/slope rate of spread with **hourly** Open-Meteo weather, minimum travel time on an AWS terrarium DEM grid (z11, ~180 m cells, ~45 km; sea doesn't burn), horizons +3/+6/+12/+24/+48 h. Replay seeds the simulation with every detection of the first satellite pass and scores it against later detections (`observed_hits`, VIIRS tolerance 2 cells). `SPEED = 0.35` was calibrated on Ofunato; don't change it without re-measuring.
- `sources.py` — FIRMS (NRT live, `VIIRS_NOAA20_SP` archive), GSI aerial mosaics cropped exactly on the point (a 404 tile means outside Japan), NASA GIBS satellite tile, Open-Meteo (current or historical at 14:00 JST). Images are cached in `app/.cache/images/` and served at `/api/images/{name}`.
- `server.py` — FastAPI: `/api/run` (SSE via `fastapi.sse`, `raw_data` JSON), `/api/images/{name}`, static `web/`.

`web/` is plain HTML/JS/CSS (Leaflet from cdnjs) built against the event contract in `odd/tasks/wildfire-sentinel.md`; keep that contract in sync when changing event payloads.

## Docs and tracking

- `odd/tasks/wildfire-sentinel.md` — feature document (specs with the user's verbatim words, task status, event contract, log). Update it after each task.
- `docs/` — research and decisions: sponsors (`03`, `04`, `11` incl. the Neo4j feedback log the sponsor asked for), Jev (`08`), data sources and spike results (`09`), integration snippets and measured latencies (`10`), product design (`12`).
- `spike/` — throwaway feasibility scripts that validated each integration; not used by the app.
