"""Spike: Jev triage verdicts stored in neo4j-agent-memory, reused on the next pass."""

import asyncio
import os
import time
from pathlib import Path

import httpx
from neo4j_agent_memory import MemoryClient, MemorySettings
from typesafe_sdk import AsyncTypeSafeClient, Image

from gsi import aerial_mosaic
from triage_test import OUT, QUESTIONS, fetch_hotspots

HEADERS = {"TypeSafe-Danger-Zone-Images": "true"}
SESSION = "wildfire-triage-demo"
MEMORY_RADIUS_KM = 1.5

LOCAL_NEO4J = {"uri": "bolt://localhost:7687", "username": "neo4j", "password": "wildfire-local-dev"}  # docker-compose.yml


def neo4j_config() -> dict:
    """Use .env credentials only when the full set is present; otherwise the local Docker instance."""
    env = {k: os.environ.get(f"NEO4J_{k.upper()}") for k in LOCAL_NEO4J}
    return env if all(env.values()) else LOCAL_NEO4J


SETTINGS = MemorySettings(
    neo4j=neo4j_config(),
    embedding={"provider": "sentence_transformers", "model": "all-MiniLM-L6-v2", "dimensions": 384},
)


async def triage(memory: MemoryClient, jev: AsyncTypeSafeClient, h: dict) -> str:
    lat, lon = float(h["latitude"]), float(h["longitude"])

    # 1. Memory first: have we already judged a hotspot near here?
    known = await memory.long_term.search_locations_near(lat, lon, radius_km=MEMORY_RADIUS_KM, limit=1)
    if known:
        place = known[0]
        verdict = (place.attributes or {}).get("land_use", "?")
        return f"MEMORY  {place.name}: {verdict} (Jev skipped)"

    # 2. Unknown place: aerial photo + Jev, recorded as a reasoning trace.
    img = OUT / f"{lat:.4f}_{lon:.4f}.jpg"
    try:
        if not img.exists():
            aerial_mosaic(lat, lon, img)
    except httpx.HTTPStatusError:
        return "SKIP    outside Japan (no GSI tile)"

    trace = await memory.reasoning.start_trace(SESSION, f"Triage FIRMS hotspot at {lat:.4f},{lon:.4f} (frp {h['frp']})")
    step = await memory.reasoning.add_step(trace.id, thought="Unknown location: classify land use from GSI aerial photo", action="jev.triage")
    started = time.perf_counter()
    r = await jev.system_one(state={"photo": Image(img)}, questions=QUESTIONS, extra_headers=HEADERS)
    ms = int((time.perf_counter() - started) * 1000)
    land = r.choices["center_land_use"]
    result = {"land_use": land.choice, "confidence": land.confidence, "houses": r.nouls["houses_nearby"].noul, "forest": r.nouls["forest_nearby"].noul}
    await memory.reasoning.record_tool_call(step.id, "jev.triage", {"lat": lat, "lon": lon}, result=result, duration_ms=ms)

    name = f"Hotspot site {lat:.3f},{lon:.3f}"
    await memory.long_term.add_entity(
        name, "LOCATION", subtype="hotspot_site", coordinates=(lat, lon), attributes=result,
        description=f"FIRMS hotspot site classified as {land.choice}", geocode=False, enrich=False,
    )
    await memory.reasoning.complete_trace(trace.id, outcome=f"{land.choice} (confidence {land.confidence:.2f})", success=True)
    return f"JEV     {name}: {land.choice} conf={land.confidence:.2f} ({ms} ms)"


async def main(limit: int = 6) -> None:
    hotspots = sorted(fetch_hotspots(), key=lambda h: float(h["frp"]), reverse=True)[:limit]
    async with MemoryClient(SETTINGS) as memory, AsyncTypeSafeClient(model="jev-preview") as jev:
        for run in (1, 2):
            print(f"\n--- pass {run} ---")
            for h in hotspots:
                print(f"{h['latitude']:>9},{h['longitude']:>10} -> {await triage(memory, jev, h)}")


if __name__ == "__main__":
    asyncio.run(main())
