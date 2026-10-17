"""FastAPI: SSE run endpoint, cached images, static map UI."""

import asyncio
import json
import os
import traceback
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.staticfiles import StaticFiles

from . import memory, sources, spread
from .config import IMAGES_DIR, ROOT
from .pipeline import Run

os.environ.setdefault("HF_HUB_OFFLINE", "1")  # embedding model is cached locally; don't hit the HF Hub per run


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the embedding model once: lazy loading from 8 concurrent triages hangs the first run.
    async with memory.client() as mem:
        await mem.long_term.search_entities("warmup", limit=1)
    yield


app = FastAPI(title="Wildfire Sentinel", lifespan=lifespan)


@app.get("/api/run", response_class=EventSourceResponse)
async def run(mode: str = "live") -> AsyncIterable[ServerSentEvent]:
    if mode not in ("live", "replay"):
        raise HTTPException(400, "mode must be live or replay")
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: str, data: dict) -> None:
        await queue.put((event, data))

    async def worker() -> None:
        try:
            await Run(mode, emit).run()
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


@app.get("/api/spread")
async def spread_prediction(lat: float, lon: float, day: str | None = None, fuel: str = "conifer_forest") -> dict:
    wx = await asyncio.to_thread(sources.weather, lat, lon, day)
    return await asyncio.to_thread(spread.simulate, lat, lon, wx, fuel)


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
