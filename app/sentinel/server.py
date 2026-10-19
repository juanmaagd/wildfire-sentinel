"""FastAPI: SSE run endpoint, cached images, static map UI."""

import asyncio
from datetime import datetime
import json
import os
import traceback

import httpx
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.staticfiles import StaticFiles

from . import analyst, graph, memory, sources, spread, video
from .config import IMAGES_DIR, JAPAN_BBOX, OFUNATO_BBOX, OFUNATO_OFFICIAL, ROOT
from .pipeline import ASSESSED, HOTSPOTS, Run, probe_on_demand, report_on_demand

os.environ.setdefault("HF_HUB_OFFLINE", "1")  # embedding model is cached locally; don't hit the HF Hub per run


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the embedding model once: lazy loading from 8 concurrent triages hangs the first run.
    async with memory.client() as mem:
        await mem.long_term.search_entities("warmup", limit=1)
    yield


app = FastAPI(title="Wildfire Sentinel", lifespan=lifespan)


def _run_args(mode: str = "live", bbox: str | None = None) -> tuple[str, tuple[float, float, float, float]]:
    """Validated before the stream opens: an HTTPException inside the SSE generator would arrive as a 200."""
    if mode not in ("live", "replay", "drill"):
        raise HTTPException(400, "mode must be live, replay or drill")
    if not bbox:
        return mode, JAPAN_BBOX
    try:  # live over the map view: "west,south,east,north", clamped to the world
        w, s, e, n = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(400, "bbox must be west,south,east,north")
    area = (max(w, -180.0), max(s, -90.0), min(e, 180.0), min(n, 90.0))
    if area[0] >= area[2] or area[1] >= area[3]:
        raise HTTPException(400, "bbox is empty")
    return mode, area


@app.get("/api/run", response_class=EventSourceResponse)
async def run(args: tuple = Depends(_run_args)) -> AsyncIterable[ServerSentEvent]:
    mode, area = args
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: str, data: dict) -> None:
        await queue.put((event, data))

    async def worker() -> None:
        try:
            await Run(mode, emit, area).run()
        except Exception as exc:  # surface failures to the UI instead of a silent hang
            traceback.print_exc()
            await queue.put(("error", {"message": f"{type(exc).__name__}: {exc}"}))
            await queue.put(("done", {}))

    task = asyncio.create_task(worker())
    try:
        while True:
            event, data = await queue.get()
            yield ServerSentEvent(raw_data=json.dumps(data, ensure_ascii=False, default=str), event=event)
            if event == "done":
                break
    finally:
        task.cancel()


def _official_points(lat: float, lon: float, start_jst: str | None) -> list[dict]:
    west, south, east, north = OFUNATO_BBOX
    if not start_jst or not (west <= lon <= east and south <= lat <= north):
        return []
    t0 = datetime.fromisoformat(start_jst)
    out = []
    for when, ha, source in OFUNATO_OFFICIAL:
        hours = max(spread.HOURS) if when is None else round((datetime.fromisoformat(when) - t0).total_seconds() / 3600, 1)
        if 0 < hours <= max(spread.HOURS):
            out.append({"time": when, "hours": hours, "official_ha": ha, "source": source})
    return out


@app.get("/api/spread")
async def spread_prediction(lat: float, lon: float, day: str | None = None, fuel: str = "conifer_forest") -> dict:
    # Replay: start from everything the satellite saw on its first pass, and overlay what it saw afterwards.
    ctx = await asyncio.to_thread(spread.replay_context, lat, lon, day) if day else {}
    wx, hourly = await asyncio.gather(
        asyncio.to_thread(sources.weather, lat, lon, day),
        asyncio.to_thread(sources.hourly_weather, lat, lon, day, 168, ctx.get("start_jst")),
    )
    official = _official_points(lat, lon, ctx.get("start_jst"))
    result = await asyncio.to_thread(spread.simulate, lat, lon, hourly, wx["rain_7d_mm"], fuel, ctx.get("seeds"),
                                     ctx.get("observed"), spread.SPEED, [p["hours"] for p in official])
    if official:  # reality check: predicted vs official burned area at the same moments
        result["reality"] = [{**p, "predicted_ha": result["area_at"][str(p["hours"])]} for p in official]
    if ctx:
        result["observed"] = ctx["observed"]
        result["start"] = ctx.get("start_label")
    return result


@app.get("/api/plan")
async def response_plan(lat: float, lon: float, at_hour: int = 0, day: str | None = None,
                        fuel: str = "conifer_forest", id: str | None = None) -> dict:
    """On demand: plan the response at hour `at_hour` of the prediction; ai& writes the tactics from the numbers."""
    ctx = await asyncio.to_thread(spread.replay_context, lat, lon, day) if day else {}
    wx, hourly = await asyncio.gather(
        asyncio.to_thread(sources.weather, lat, lon, day),
        asyncio.to_thread(sources.hourly_weather, lat, lon, day, 168, ctx.get("start_jst")),
    )
    result = await asyncio.to_thread(spread.plan, lat, lon, hourly, wx["rain_7d_mm"], fuel, ctx.get("seeds"), at_hour)
    site = ASSESSED.get(id or "", {}).get("facts", {})
    later = [str(h) for h in spread.HOURS if h > at_hour]
    facts = {
        "plan_decided_at": {"hours_after_detection": at_hour, "local_time_jst": result["plan_time"]},
        "burning_now_ha": result["burning_ha"],
        "control_line": {"length_km": result["line_km"], "type": result["line_type"],
                         "ready_within_h": result["lead_h"], "crews_needed": result["crews"]},
        "fire_head_heading_deg": result["head_direction_deg"],
        "burned_area_ha_by_hour": {h: {"no_action": result["area_ha"]["no_action"][h],
                                       "with_plan": result["area_ha"]["with_plan"][h]} for h in later},
        "weather_next_12h": result["weather_next_12h"], "fuel": fuel,
        "aerial_photo_findings": site.get("jev_probe"), "houses_downwind": site.get("houses_downwind"),
    }
    try:
        plan, model, ms = await analyst.response_plan(facts)
        result["brief"] = {**plan, "model": model, "latency_ms": ms}
    except Exception as exc:  # the computed plan is still useful without the narrative
        result["brief"] = None
        result["brief_error"] = f"{type(exc).__name__}: {exc}"
    return result


@app.get("/api/graph")
async def fire_graph(lat: float, lon: float, day: str, name: str = "Fire incident") -> dict:
    """Write the incident's propagation graph to Neo4j and return it with the Cypher-computed insights."""
    return await asyncio.to_thread(graph.build, lat, lon, day, name)


def _scenario(lat: float, lon: float, day: str | None) -> str:
    return f"{lat:.3f},{lon:.3f},{day or 'live'}"


@app.post("/api/video")
async def create_video(frames: list[UploadFile] = File(...), hours: str = Form(...), areas: str = Form(...),
                       lat: float = Form(...), lon: float = Form(...), day: str | None = Form(None),
                       head_deg: float = Form(...), wind_ms: float = Form(...), fuel: str = Form("conifer_forest")) -> dict:
    """On demand: MiniMax H3 (ai&) animates between consecutive keyframes rendered from our own 3D prediction."""
    data = [await f.read() for f in frames]
    hs, ars = [int(x) for x in hours.split(",")], [float(x) for x in areas.split(",")]
    if len(data) < 2 or len(data) != len(hs) or len(hs) != len(ars):
        raise HTTPException(400, "need matching frames, hours and areas (at least two keyframes)")
    return await asyncio.to_thread(video.start, _scenario(lat, lon, day), data, hs, ars, head_deg, wind_ms, fuel)


@app.get("/api/video/{video_id}")
async def video_status(video_id: str) -> dict:
    try:
        return await asyncio.to_thread(video.poll, video_id)
    except KeyError:
        raise HTTPException(404, "unknown video job")


@app.get("/api/videos")
async def videos(lat: float, lon: float, day: str | None = None) -> list[dict]:
    """Clips already generated for this scenario (pre-generated for the demo)."""
    return video.listing(_scenario(lat, lon, day))


@app.get("/api/probe/{hotspot_id}")
async def probe(hotspot_id: str) -> dict:
    if hotspot_id not in HOTSPOTS:
        raise HTTPException(404, "unknown hotspot (run live or replay first)")
    return await probe_on_demand(hotspot_id)


@app.get("/api/report/{hotspot_id}")
async def report(hotspot_id: str) -> dict:
    if hotspot_id not in HOTSPOTS:
        raise HTTPException(404, "unknown hotspot (run live or replay first)")
    return await report_on_demand(hotspot_id)


TILES = httpx.AsyncClient(timeout=15)


@app.get("/api/tiles/imagery/{z}/{x}/{y}")
async def imagery_tile(z: int, x: int, y: int) -> Response:
    """Esri World Imagery for the map outside GSI coverage, proxied so ESRI_API_KEY stays on the server."""
    resp = await TILES.get(sources._tile_url("esri", z, x, y))
    if resp.status_code != 200:
        raise HTTPException(resp.status_code if resp.status_code == 404 else 502, "tile unavailable")
    return Response(resp.content, media_type=resp.headers.get("content-type", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/images/{name}")
async def image(name: str) -> FileResponse:
    path = (IMAGES_DIR / name).resolve()
    if path.parent != IMAGES_DIR.resolve() or not path.exists():
        raise HTTPException(404)
    return FileResponse(path)


# Serve the React build when present (frontend/dist), else the vanilla fallback UI (web/).
DIST = Path(ROOT) / "frontend" / "dist"
WEB = DIST if (DIST / "index.html").exists() else Path(ROOT) / "web"
app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
