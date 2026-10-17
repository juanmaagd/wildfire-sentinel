"""End-to-end spike: real FIRMS hotspots -> GSI aerial mosaic -> Jev triage."""

import csv
import io
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from typesafe_sdk import Choice, Image, Noul, TypeSafeClient

from gsi import aerial_mosaic

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

JAPAN_BBOX = "128,30,146,46"  # west,south,east,north (includes some non-Japan land; filter later)
OUT = Path(__file__).parent / "images" / "hotspots"
HEADERS = {"TypeSafe-Danger-Zone-Images": "true"}

QUESTIONS = {
    "center_land_use": Choice(
        instructions="A satellite detected a heat source at the exact center of the aerial photo `photo`. What is at the center of `photo`?",
        criteria={
            "forest_or_grassland": "Trees, bush, grass or other natural vegetation.",
            "industrial": "Factory, steel mill, refinery, power plant, storage tanks or large industrial roofs.",
            "residential": "Houses or apartment buildings.",
            "farmland": "Agricultural fields, paddies or greenhouses.",
            "volcano_or_bare": "Volcanic crater, bare rock or bare soil.",
            "water": "Sea, lake or river.",
        },
    ),
    "houses_nearby": Noul(instructions="Are residential houses visible in `photo`?"),
    "forest_nearby": Noul(instructions="Is there forest or dense natural vegetation in `photo`?"),
}


def fetch_hotspots(days: int = 2) -> list[dict]:
    key = os.environ.get("FIRMS_MAP_KEY") or os.environ["MAP_KEYS"]
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_NOAA20_NRT/{JAPAN_BBOX}/{days}"
    resp = httpx.get(url, timeout=30)
    resp.raise_for_status()
    return list(csv.DictReader(io.StringIO(resp.text)))


def main(limit: int = 8) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    hotspots = fetch_hotspots()
    # Deduplicate nearby detections (same ~1 km cell) and keep the strongest ones.
    cells: dict[tuple[float, float], dict] = {}
    for h in hotspots:
        cell = (round(float(h["latitude"]), 2), round(float(h["longitude"]), 2))
        if cell not in cells or float(h["frp"]) > float(cells[cell]["frp"]):
            cells[cell] = h
    picked = sorted(cells.values(), key=lambda h: float(h["frp"]), reverse=True)[:limit]
    print(f"{len(hotspots)} detections -> {len(cells)} unique cells -> triaging top {len(picked)} by FRP")

    with TypeSafeClient(model="jev-preview") as client:
        for h in picked:
            lat, lon = float(h["latitude"]), float(h["longitude"])
            img = OUT / f"{lat:.4f}_{lon:.4f}.jpg"
            try:
                if not img.exists():
                    aerial_mosaic(lat, lon, img)
            except httpx.HTTPStatusError:
                print(f"- {lat:.4f},{lon:.4f}: no GSI tile (likely outside Japan)")
                continue
            started = time.perf_counter()
            r = client.system_one(state={"photo": Image(img)}, questions=QUESTIONS, extra_headers=HEADERS)
            ms = (time.perf_counter() - started) * 1000
            land = r.answers["center_land_use"]
            print(
                f"- {lat:.4f},{lon:.4f} frp={h['frp']:>6} -> {land.choice:<20} conf={land.confidence:.2f} "
                f"houses={r.answers['houses_nearby'].noul:.2f} forest={r.answers['forest_nearby'].noul:.2f} ({ms:.0f} ms)"
            )


if __name__ == "__main__":
    main()
