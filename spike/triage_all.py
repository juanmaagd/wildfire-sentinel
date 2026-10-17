"""Spike: triage every unique FIRMS hotspot cell in Japan with Jev; save results to JSON."""

import asyncio
import json
import time
from collections import Counter
from pathlib import Path

import httpx
from typesafe_sdk import AsyncTypeSafeClient, Image

from gsi import aerial_mosaic
from triage_test import OUT, QUESTIONS, fetch_hotspots

HEADERS = {"TypeSafe-Danger-Zone-Images": "true"}
RESULTS = Path(__file__).parent / "triage_results.json"


def unique_cells(hotspots: list[dict]) -> list[dict]:
    cells: dict[tuple[float, float], dict] = {}
    for h in hotspots:
        cell = (round(float(h["latitude"]), 2), round(float(h["longitude"]), 2))
        cells.setdefault(cell, {**h, "detections": 0})
        cells[cell]["detections"] += 1
    return list(cells.values())


async def one(jev: AsyncTypeSafeClient, sem: asyncio.Semaphore, h: dict) -> dict | None:
    lat, lon = float(h["latitude"]), float(h["longitude"])
    img = OUT / f"{lat:.4f}_{lon:.4f}.jpg"
    try:
        if not img.exists():
            await asyncio.to_thread(aerial_mosaic, lat, lon, img)
    except httpx.HTTPStatusError:
        return None  # outside Japan
    async with sem:
        r = await jev.system_one(state={"photo": Image(img)}, questions=QUESTIONS, extra_headers=HEADERS)
    land = r.choices["center_land_use"]
    return {
        "lat": lat, "lon": lon, "frp": float(h["frp"]), "detections": h["detections"],
        "acq_date": h["acq_date"], "acq_time": h["acq_time"], "image": str(img.name),
        "land_use": land.choice, "confidence": land.confidence,
        "houses": r.nouls["houses_nearby"].noul, "forest": r.nouls["forest_nearby"].noul,
    }


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cells = unique_cells(fetch_hotspots())
    started = time.perf_counter()
    sem = asyncio.Semaphore(8)
    async with AsyncTypeSafeClient(model="jev-preview") as jev:
        results = [r for r in await asyncio.gather(*(one(jev, sem, h) for h in cells)) if r]
    print(f"{len(cells)} cells -> {len(results)} in Japan, triaged in {time.perf_counter() - started:.1f}s")
    print(Counter(r["land_use"] for r in results))
    RESULTS.write_text(json.dumps(results, indent=2))
    for r in sorted(results, key=lambda r: (r["land_use"] == "industrial", -r["frp"]))[:12]:
        print(f"  {r['lat']:.4f},{r['lon']:.4f} {r['land_use']:<20} conf={r['confidence']:.2f} houses={r['houses']:.2f} forest={r['forest']:.2f} frp={r['frp']}")


if __name__ == "__main__":
    asyncio.run(main())
