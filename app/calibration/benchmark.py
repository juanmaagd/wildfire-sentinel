"""Spread model benchmark: the same fires and metrics before and after every model change.

Truth is what the satellite saw (VIIRS), the only source available for every fire: the model starts from the first
pass and is scored at +12/+24/+30 h, before firefighting changes the outcome much ("no firefighting" model).
  recall     later detections (up to T) inside the predicted area (±2 cells, VIIRS geolocation)
  precision  predicted cells within ±2 cells of a detection (seen burning by T)
  F1         both together: the fitting objective (area alone rewards a wrong shape)
  ratio      predicted area / detected footprint area

Run from app/:  uv run python -m calibration.benchmark --label baseline
"""

import argparse
import json
import math
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from sentinel import sources, spread
from sentinel.config import CACHE_DIR, OFUNATO_OFFICIAL, REPLAY_SOURCES

from .fires import FIRES

HERE = Path(__file__).parent
CACHE = CACHE_DIR / "calibration"
EVAL_HOURS = (12, 24, 30)
K = spread.VIIRS_TOLERANCE_CELLS


SEED_KM = 5  # the first pass must have a detection this close to the fire's origin
CHAIN_KM = 10  # a later detection belongs to the fire if it is this close to something already part of it


def _km(a: tuple, b: tuple) -> float:
    return math.hypot((a[0] - b[0]) * 111.2, (a[1] - b[1]) * 111.2 * math.cos(math.radians(a[0])))


def track(lat: float, lon: float, day: str) -> dict:
    """One fire's detections: the first pass with a detection near the origin, then detections chained to it.
    A plain bounding box mixes in refineries and neighbouring fires (Palisades started from Torrance refineries)."""
    box = (lon - 0.3, lat - 0.3, lon + 0.3, lat + 0.3)
    second = (datetime.fromisoformat(day) + timedelta(days=5)).date().isoformat()
    rows = sources.fetch_hotspots_multi(box, 5, day, REPLAY_SOURCES) + sources.fetch_hotspots_multi(box, 4, second, REPLAY_SOURCES)
    pts = sorted(((datetime.strptime(f"{r['acq_date']} {int(r['acq_time']):04d}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc),
                   float(r["latitude"]), float(r["longitude"])) for r in rows))
    near = [t for t, a, b in pts if _km((a, b), (lat, lon)) <= SEED_KM]
    if not near:
        closest = min(pts, key=lambda p: _km(p[1:], (lat, lon)), default=None)
        raise ValueError(f"no detection within {SEED_KM} km of {lat},{lon} on {day}; closest: {closest}")
    t0 = near[0]
    seeds = [(a, b) for t, a, b in pts if 0 <= (t - t0).total_seconds() < 3600 and _km((a, b), (lat, lon)) <= SEED_KM]
    fire, observed = list(seeds), []
    for t, a, b in pts:
        hours = (t - t0).total_seconds() / 3600
        if 1 <= hours <= max(EVAL_HOURS) and any(_km((a, b), p) <= CHAIN_KM for p in fire):
            fire.append((a, b))
            observed.append({"type": "Feature", "properties": {"hours_after": round(hours, 1)},
                             "geometry": {"type": "Point", "coordinates": [b, a]}})
    return {"start_jst": t0.astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%dT%H:00"), "seeds": seeds,
            "observed": observed}


def load(fire: tuple) -> dict:
    """Detections, hourly weather and terrain for one fire, downloaded once and cached on disk."""
    name, lat, lon, day = fire[:4]
    CACHE.mkdir(parents=True, exist_ok=True)
    meta, grid = CACHE / f"{name}.json", CACHE / f"{name}_dem.npz"
    if not meta.exists():
        ctx = track(lat, lon, day)
        s = ctx["seeds"]
        clat, clon = sum(a for a, _ in s) / len(s), sum(b for _, b in s) / len(s)  # grid centered on the first pass
        hourly = sources.hourly_weather(clat, clon, day, 48, ctx["start_jst"])
        rain_7d = sources.weather(clat, clon, day)["rain_7d_mm"]
        meta.write_text(json.dumps({"lat": clat, "lon": clon, **ctx, "hourly": hourly, "rain_7d": rain_7d}))
    data = json.loads(meta.read_text())
    if not grid.exists():
        dem, cell_m, ox, oy = spread._dem(data["lat"], data["lon"])
        np.savez_compressed(grid, dem=dem, meta=np.array([cell_m, ox, oy]))
    g = np.load(grid)
    data["grid"] = (g["dem"], *map(float, g["meta"]))
    return data


def _cell(ctx: dict, lat: float, lon: float) -> tuple[int, int]:
    x, y = spread._merc_px(lat, lon, spread.ZOOM)
    return int((y - ctx["oy"]) / spread.DOWNSAMPLE), int((x - ctx["ox"]) / spread.DOWNSAMPLE)


def evaluate(fire: tuple, params: dict) -> dict:
    """Run the model on one fire and score it against the detections at each evaluation hour."""
    data = load(fire)
    started = time.perf_counter()
    ctx = spread._prepare(data["lat"], data["lon"], data["hourly"], data["rain_7d"], params.get("fuel", "conifer_forest"),
                          [tuple(s) for s in data["seeds"]], params["speed"], data["grid"], params.get("fuel_factors"))
    T = spread._arrival(ctx, ctx["burnable"], horizon_h=max(EVAL_HOURS))
    H, W = T.shape
    cell_ha = ctx["cell_m"] ** 2 / 1e4
    seeds = [_cell(ctx, a, b) for a, b in data["seeds"]]
    obs = [(f["properties"]["hours_after"], _cell(ctx, f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]))
           for f in data["observed"]]
    out = {"split": fire[4], "note": fire[5], "seeds": len(seeds), "hours": {}}
    for h in EVAL_HOURS:
        pred = T <= 60 * h
        seen = np.zeros((H, W), bool)  # detection footprint: seeds + detections up to h, ±K cells
        later = [c for t, c in obs if t <= h]
        for r, c in seeds + later:
            if 0 <= r < H and 0 <= c < W:
                seen[max(0, r - K): r + K + 1, max(0, c - K): c + K + 1] = True
        inside = [pred[max(0, r - K): r + K + 1, max(0, c - K): c + K + 1].any() for r, c in later if 0 <= r < H and 0 <= c < W]
        recall = sum(inside) / len(inside) if inside else None
        precision = float((pred & seen).sum() / pred.sum()) if pred.sum() else 0.0
        f1 = 2 * precision * recall / (precision + recall) if recall and precision else 0.0 if recall is not None else None
        out["hours"][str(h)] = {"recall": recall, "precision": round(precision, 3), "f1": f1 and round(f1, 3),
                                "pred_ha": round(float(pred.sum()) * cell_ha), "seen_ha": round(float(seen.sum()) * cell_ha),
                                "detections": len(later)}
        if recall is not None:
            out["hours"][str(h)]["recall"] = round(recall, 3)
    if fire[0] == "ofunato":  # the one fire with an official early figure
        when, ha, src = OFUNATO_OFFICIAL[0]
        hours = (datetime.fromisoformat(when) - datetime.fromisoformat(data["start_jst"])).total_seconds() / 3600
        T48 = spread._arrival(ctx, ctx["burnable"], horizon_h=math.ceil(hours))
        out["official"] = {"hours": round(hours, 1), "official_ha": ha, "pred_ha": round(float((T48 <= 60 * hours).sum()) * cell_ha), "source": src}
    out["ms"] = int((time.perf_counter() - started) * 1000)
    return out


def run(params: dict, names: list[str] | None = None) -> dict:
    fires = [f for f in FIRES if not names or f[0] in names]
    for f in fires:  # downloads are sequential and cached; the simulations then run in parallel
        load(f)
    with ProcessPoolExecutor() as pool:
        results = dict(zip([f[0] for f in fires], pool.map(evaluate, fires, [params] * len(fires))))
    return results


def summary(results: dict) -> dict:
    """Mean of each metric per split and evaluation hour (fires without later detections are skipped for recall/F1)."""
    out = {}
    for split in ("train", "test", "all"):
        rs = [r for r in results.values() if split == "all" or r["split"] == split]
        for h in EVAL_HOURS:
            row = {}
            for m in ("recall", "precision", "f1"):
                vals = [r["hours"][str(h)][m] for r in rs if r["hours"][str(h)][m] is not None]
                row[m] = round(sum(vals) / len(vals), 3) if vals else None
            ratios = [r["hours"][str(h)]["pred_ha"] / r["hours"][str(h)]["seen_ha"] for r in rs if r["hours"][str(h)]["seen_ha"]]
            row["ratio_median"] = round(float(np.median(ratios)), 2) if ratios else None
            out.setdefault(split, {})[str(h)] = row
    return out


def table(results: dict, summ: dict) -> str:
    lines = ["| fire | split | +12 h F1 | +24 h F1 | +30 h F1 | +30 h recall | +30 h precision | +30 h predicted / detected ha |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for name, r in results.items():
        h = r["hours"]
        lines.append(f"| {name} | {r['split']} | {h['12']['f1']} | {h['24']['f1']} | {h['30']['f1']} | {h['30']['recall']} | "
                     f"{h['30']['precision']} | {h['30']['pred_ha']} / {h['30']['seen_ha']} |")
    lines += ["", "| split | hour | recall | precision | F1 | median area ratio |", "| --- | --- | --- | --- | --- | --- |"]
    for split, rows in summ.items():
        for h, row in rows.items():
            lines.append(f"| {split} | +{h} h | {row['recall']} | {row['precision']} | {row['f1']} | {row['ratio_median']} |")
    return "\n".join(lines)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--speed", type=float, default=spread.SPEED)
    ap.add_argument("--fuel", default="conifer_forest")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--landcover", action="store_true", help="per-cell fuel from ESA WorldCover (spread.FUEL_FACTORS)")
    ap.add_argument("--fitted", action="store_true", help="speed and fuel factors from results/fit.json")
    a = ap.parse_args()
    params = {"speed": a.speed, "fuel": a.fuel, "fuel_factors": spread.FUEL_FACTORS if a.landcover else None}
    if a.fitted:
        params.update(json.loads((HERE / "results" / "fit.json").read_text())["params"])
    results = run(params, a.only)
    summ = summary(results)
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / f"{a.label}.json").write_text(json.dumps({"params": params, "summary": summ, "fires": results}, indent=1))
    print(table(results, summ))
    if "ofunato" in results and "official" in results["ofunato"]:
        print("\nOfunato official:", results["ofunato"]["official"])
