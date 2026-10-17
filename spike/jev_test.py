"""Feasibility spike: can Jev judge aerial and satellite images for wildfire triage?"""

import time
from pathlib import Path

from dotenv import load_dotenv
from typesafe_sdk import Choice, Image, Noul, Score, TypeSafeClient

from gsi import aerial_mosaic

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

IMAGES = Path(__file__).parent / "images"
HEADERS = {"TypeSafe-Danger-Zone-Images": "true"}

AERIAL_QUESTIONS = {
    "land_use": Choice(
        instructions="What is the dominant land use in the aerial photo `photo`?",
        criteria={
            "forest": "Mostly trees or natural vegetation.",
            "industrial": "Factories, warehouses, refineries, large industrial roofs or tanks.",
            "residential": "Mostly houses and small streets.",
            "farmland": "Agricultural fields or paddies.",
            "water": "Mostly sea, lake or river.",
        },
    ),
    "houses_visible": Noul(instructions="Are residential houses visible anywhere in `photo`?"),
}

SATELLITE_QUESTIONS = {
    "cloud_cover": Score(
        instructions="How much of the satellite image `photo` is covered by clouds?",
        criteria=[
            "Clear: almost no clouds, the ground is visible.",
            "Partly cloudy: clouds cover some of the image, much ground visible.",
            "Mostly cloudy: clouds cover most of the image.",
            "Overcast: the ground is barely visible.",
        ],
    ),
    "smoke_plume": Noul(
        instructions="Is a smoke plume from a fire visible in the satellite image `photo` (a grey or brown haze streaming from a point source, distinct from white clouds)?"
    ),
}

AERIAL_POINTS = {
    "mosaic_ofunato_forest.jpg": (39.07, 141.78),
    "mosaic_keiyo_refinery.jpg": (35.52, 140.07),
    "mosaic_ofunato_town.jpg": (39.065, 141.715),
}
for name, (lat, lon) in AERIAL_POINTS.items():
    if not (IMAGES / name).exists():
        aerial_mosaic(lat, lon, IMAGES / name)

CASES = [
    *((name, AERIAL_QUESTIONS) for name in AERIAL_POINTS),
    ("wide_2025-03-02_VIIRS.jpg", SATELLITE_QUESTIONS),
    ("ofunato_clear_2025-02-15.jpg", SATELLITE_QUESTIONS),
    ("wide_2025-02-28_MODIS.jpg", SATELLITE_QUESTIONS),
]


def main() -> None:
    with TypeSafeClient(model="jev-preview") as client:
        for filename, questions in CASES:
            started = time.perf_counter()
            response = client.system_one(
                state={"photo": Image(IMAGES / filename)},
                questions=questions,
                extra_headers=HEADERS,
            )
            elapsed_ms = (time.perf_counter() - started) * 1000
            print(f"\n== {filename}  ({elapsed_ms:.0f} ms, model {response.model})")
            for qid, answer in response.answers.items():
                print(f"  {qid}: {answer}")


if __name__ == "__main__":
    main()
