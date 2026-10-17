# 10 — Integration Reference

Verified snippets for every service in the pipeline. Sources: context7 (Neo4j driver, TypeSafe, FastAPI), official ai& docs, and our own spikes (`spike/`).

Pipeline: **FIRMS** (hotspots) → **GSI** (aerial photo) → **Jev** (triage) → **Neo4j** (memory) → **ai&** (escalation + alert text) → **FastAPI** + map UI.

## Environment (`.env`, never committed)

| Variable | Service | Status |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Jev | ✅ working |
| `MAP_KEYS` | NASA FIRMS | ✅ working |
| `AIAND_API_KEY` | ai& | ✅ working |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | Neo4j Aura | ⏳ URI empty → code falls back to local Docker (`docker-compose.yml`) |

## Spike results summary (2026-10-17)

| Step | Tool | Latency | Result |
| --- | --- | --- | --- |
| Hotspots | FIRMS | ~1 s | 155 detections / 2 days in Japan bbox |
| Aerial photo | GSI | ~1 s (9 tiles) | 768 px mosaic |
| Triage | Jev `jev-1.14.0` | **150–300 ms** | Clear cases conf ≥ 0.9; mixed area conf 0.40 |
| Escalation | ai& `zai-org/glm-5.3-flash` (vision, strict JSON) | **~4.7 s** | Mixed area → `industrial`, houses within 500 m, with a sensible reason |
| Alert text | ai& `deepseek-ai/deepseek-v4-flash` (`reasoning_effort="none"`) | **~0.9 s** | 3-line Japanese alert |
| Memory | neo4j-agent-memory (local Docker) | — | 2nd pass: 100% memory hits, 0 Jev calls |

Notes:
- Jev is ~20× faster than the vision LLM → escalate **only** when Jev confidence is low ("System 1 / System 2").
- The alert model **invented a time ("12:00頃")** not present in the facts → always pass the detection timestamp and keep the recommended action tied to explicit rules (e.g. evacuation advice only when houses are nearby).

## 1. NASA FIRMS — hotspots (verified)

```python
url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_NOAA20_NRT/{west},{south},{east},{north}/{days}"
# Japan bbox used: 128,30,146,46  · days: 1..5 · returns CSV
```

Columns: `latitude, longitude, bright_ti4, scan, track, acq_date, acq_time, satellite, instrument, confidence (l/n/h), version, bright_ti5, frp, daynight`. Other sources: `VIIRS_SNPP_NRT`, `MODIS_NRT`. Dedupe by rounding lat/lon to 2 decimals (~1 km).

## 2. GSI aerial photos (verified)

```python
TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"  # no key
```

- Tiles are 256 px; Jev needs ≥ 280 px → stitch 3×3 at z16 (768 px, ~1.8 km). See `spike/gsi.py`.
- 404 on a tile ⇒ point is outside Japan (free country filter).
- Attribution in the UI: **出典：国土地理院**.

## 3. TypeSafe Jev (verified, SDK `typesafe-sdk` 0.7.5)

```python
from typesafe_sdk import AsyncTypeSafeClient, Choice, Image, Noul, RetryPolicy

async with AsyncTypeSafeClient(model="jev-preview", retry=RetryPolicy(max_retries=5, backoff_initial=1.0, backoff_max=20.0)) as client:
    sem = asyncio.Semaphore(8)  # cap concurrency for 429s
    async with sem:
        r = await client.system_one(
            state={"photo": Image(path)},
            questions={"center_land_use": Choice(...), "houses_nearby": Noul(...)},
            extra_headers={"TypeSafe-Danger-Zone-Images": "true"},
        )
r.choices["center_land_use"].choice / .probabilities / .confidence
r.nouls["houses_nearby"].noul
r.model, r.usage.input_tokens, r.request_id
```

- Images: PNG/JPEG, **280–1568 px per side**, header required, `jev-preview` (1.14) for Box.
- Errors: `TypeSafeRateLimitError` (`.retry_after_ms`), `TypeSafeBadRequestError` (e.g. "Invalid image dimensions"), `TypeSafeAPIConnectionError`.

## 4. ai& — escalation and alert text (from docs.aiand.com; not yet run, no key)

```python
from openai import OpenAI  # pip install openai
client = OpenAI(base_url="https://api.aiand.com/v1", api_key=os.environ["AIAND_API_KEY"])

# Vision escalation when Jev confidence is low (model must have the `vision` capability)
client.chat.completions.create(
    model="zai-org/glm-5.3-flash",  # or qwen/qwen3.8-27b
    messages=[{"role": "user", "content": [
        {"type": "text", "text": "..."},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
    ]}],
    response_format={"type": "json_schema", "json_schema": {"name": "verdict", "strict": True, "schema": {...}}},
)

# Alert text (Japanese) — cheap text model
client.chat.completions.create(model="deepseek-ai/deepseek-v4-flash", messages=[...])
```

- Vision input: public URL, base64 data URL, or uploaded `file_id` (Files API, `purpose: "vision"`). PNG/JPEG/WebP/GIF, max 100 MiB.
- Structured outputs: `json_object` or strict `json_schema`; `client.chat.completions.parse()` with Pydantic also works.
- Requests to a model without `vision` are rejected.

## 5. Neo4j (driver docs via context7; not yet run, no instance)

```python
from neo4j import GraphDatabase, RoutingControl  # pip install neo4j

driver = GraphDatabase.driver(os.environ["NEO4J_URI"], auth=(os.environ["NEO4J_USERNAME"], os.environ["NEO4J_PASSWORD"]))
driver.verify_connectivity()

driver.execute_query(
    "MERGE (h:Hotspot {id: $id}) SET h += $props "
    "MERGE (p:Prefecture {name: $prefecture}) MERGE (h)-[:IN]->(p)",
    id=..., props={...}, prefecture=..., database_="neo4j",
)
records, _, _ = driver.execute_query("MATCH ... RETURN ...", routing_=RoutingControl.READ, database_="neo4j")
```

- Aura URI scheme: `neo4j+s://<id>.databases.neo4j.io`. One long-lived driver per app (thread-safe).
- **AuraDB Free**: $0, no card, **one Free instance per account**, node/relationship count limits (exact numbers not confirmed; our scale is hundreds of nodes), **auto-pauses after 72 h of inactivity**, no Graph Analytics (GDS). Credentials are shown **once** at creation: download them.
- Fallback without Aura: local Docker `neo4j:5` (same driver, `neo4j://localhost:7687`).

## 6. FastAPI — backend + single page (docs via context7)

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.sse import EventSourceResponse, ServerSentEvent  # stream triage results live to the map

app = FastAPI(lifespan=lifespan)          # open Neo4j driver / Jev client once
app.mount("/", StaticFiles(directory="web", html=True), name="web")

@app.get("/api/triage/stream", response_class=EventSourceResponse)
async def stream():
    yield ServerSentEvent(data=json.dumps(result), event="hotspot")
```
