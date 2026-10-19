"""Does Jev give the same stage-1 verdict on Esri World Imagery as on GSI? Same Japanese sites, both providers,
plus known sites abroad (Esri only). Run from app/: uv run python ../spike/provider_compare.py"""

import asyncio
import collections
import json
import pathlib
import random

from sentinel import jev, scoring, sources

HERE = pathlib.Path(__file__).parent
JAPAN_FOREST = [  # known vegetated sites in Japan, to check both providers on the "possible_fire" side too
    (39.0450, 141.7300, "ofunato_forest"),
    (36.3427, 139.4462, "ashikaga_drill"),
    (35.3606, 138.7274, "fuji_forest"),
    (34.2167, 135.5833, "kii_forest"),
    (43.4500, 142.7000, "hokkaido_forest"),
    (32.8800, 131.1000, "aso_grassland"),
]
ABROAD = [  # (name, lat, lon, expected verdict)
    ("POSCO Pohang steelworks, KR", 35.9906, 129.3836, "industrial"),
    ("US Steel Gary Works, US", 41.6097, -87.3280, "industrial"),
    ("Tata Steel IJmuiden, NL", 52.4778, 4.6050, "industrial"),
    ("Ras Tanura refinery, SA", 26.6417, 50.1567, "industrial"),
    ("Jasper forest, CA", 52.8300, -118.0500, "possible_fire"),
    ("Pedrogao Grande pine forest, PT", 39.9400, -8.2300, "possible_fire"),
    ("Evros forest, GR", 41.0500, 26.1000, "possible_fire"),
    ("California chaparral, US", 34.1200, -118.6200, "possible_fire"),
]


async def verdict(jv, sem, path) -> tuple[str, float]:
    async with sem:
        signals, _ = await jev.sentinel(jv, path)
    return scoring.classify(signals)


async def main() -> None:
    rows = json.loads((HERE / "triage_results.json").read_text())
    by = collections.defaultdict(list)
    for r in rows:
        by[r["land_use"]].append(r)
    random.seed(1)
    japan = [r for rows_ in by.values() for r in random.sample(rows_, min(6, len(rows_)))]
    japan += [{"lat": lat, "lon": lon, "land_use": label} for lat, lon, label in JAPAN_FOREST]
    jv, sem = jev.client(), asyncio.Semaphore(6)

    async def site(lat, lon, provider):
        name = f"cmp_{provider}_{lat:.4f}_{lon:.4f}_z16.jpg"
        path = await asyncio.to_thread(sources.aerial_mosaic, lat, lon, 16, name, 768, provider)
        return await verdict(jv, sem, path)

    jp = await asyncio.gather(*[asyncio.gather(site(r["lat"], r["lon"], "gsi"), site(r["lat"], r["lon"], "esri"))
                                for r in japan])
    agree = 0
    print("JAPAN  spike-label | GSI verdict | Esri verdict")
    for r, ((g, gc), (e, ec)) in zip(japan, jp):
        agree += g == e
        print(f"{r['lat']:.4f},{r['lon']:.4f}  {r['land_use']:<14} | {g:<14} {gc:.2f} | {e:<14} {ec:.2f}{'' if g == e else '  <-'}")
    print(f"agreement GSI vs Esri: {agree}/{len(japan)}\n")
    ab = await asyncio.gather(*[site(lat, lon, "esri") for _, lat, lon, _ in ABROAD])
    ok = 0
    print("ABROAD (Esri)  expected | verdict")
    for (name, *_ , exp), (v, c) in zip(ABROAD, ab):
        ok += v == exp
        print(f"{name:<34} {exp:<14} | {v:<14} {c:.2f}{'' if v == exp else '  <-'}")
    print(f"correct abroad: {ok}/{len(ABROAD)}")


asyncio.run(main())
