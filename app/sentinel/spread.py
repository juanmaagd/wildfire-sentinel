"""Fire spread prediction: elliptical wind-driven rate of spread + slope, minimum travel time on a terrain grid.

Terrain: AWS Terrain Tiles (terrarium), z11 3x3 mosaic (~45 km), downsampled to ~180 m cells. Sea (elev <= 0) doesn't burn.
Weather varies hour by hour (Open-Meteo hourly): wind direction/speed and humidity change the spread as time passes.
Output: perimeters at +3/+6/+12/+24/+48 h as GeoJSON, head path, burned area.
"""

import heapq
import io
import math
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import numpy as np
from PIL import Image
from skimage import measure

from . import landcover, scoring
from .config import CACHE_DIR

TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM, TILES, DOWNSAMPLE = 11, 3, 3
HOURS = (3, 6, 12, 24, 48, 72, 96, 120, 168)
SPEED = 1.0  # calibrated on 18 fires, first 30 h vs VIIRS, with fuel moisture + land cover (docs/16-spread-calibration.md)
VIIRS_TOLERANCE_CELLS = 2  # ~375 m VIIRS pixel ≈ 2 grid cells
EARTH = 40075016.686
DEM_CACHE = CACHE_DIR / "dem"


def _merc_px(lat: float, lon: float, z: int) -> tuple[float, float]:
    n = 256 * 2**z
    lat_rad = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n


def _px_to_lonlat(x: float, y: float, z: int) -> tuple[float, float]:
    n = 256 * 2**z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def _dem(lat: float, lon: float) -> tuple[np.ndarray, float, float, float]:
    """Returns (elevation grid, cell size m, origin x px, origin y px) at ZOOM in global pixel space.
    Cached on disk per tile block: every point inside the same center tile reuses it."""
    px, py = _merc_px(lat, lon, ZOOM)
    tx0, ty0 = int(px // 256) - TILES // 2, int(py // 256) - TILES // 2
    path = DEM_CACHE / f"z{ZOOM}_{tx0}_{ty0}.npy"
    if path.exists():
        grid = np.load(path)
        return grid, _cell_m(lat), tx0 * 256.0, ty0 * 256.0
    grid = np.zeros((256 * TILES, 256 * TILES), dtype=np.float32)

    def fetch(dy: int, dx: int) -> None:
        r = client.get(TERRARIUM.format(z=ZOOM, x=tx0 + dx, y=ty0 + dy))
        r.raise_for_status()
        rgb = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), dtype=np.float32)
        grid[dy * 256:(dy + 1) * 256, dx * 256:(dx + 1) * 256] = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768

    with httpx.Client(timeout=20) as client, ThreadPoolExecutor(TILES * TILES) as pool:
        list(pool.map(lambda i: fetch(*divmod(i, TILES)), range(TILES * TILES)))
    h = grid.shape[0] // DOWNSAMPLE
    grid = grid[: h * DOWNSAMPLE, : h * DOWNSAMPLE].reshape(h, DOWNSAMPLE, h, DOWNSAMPLE).mean(axis=(1, 3))
    DEM_CACHE.mkdir(parents=True, exist_ok=True)
    np.save(path, grid)
    return grid, _cell_m(lat), tx0 * 256.0, ty0 * 256.0


def _cell_m(lat: float) -> float:
    return EARTH * math.cos(math.radians(lat)) / (256 * 2**ZOOM) * DOWNSAMPLE


# Fuel factor per ESA WorldCover group (same scale as scoring.FUEL, 1.0 = conifer forest), cell by cell in production:
# crops, towns and bare ground slow the fire, inland water and snow don't burn. Prior values (fitting them overfit).
FUEL_FACTORS = {"tree": 1.0, "shrub": 0.9, "grass": 0.8, "crop": 0.35, "built": 0.15, "bare": 0.1, "wetland": 0.3}

# Dead fine-fuel moisture (fraction of dry weight), tracked hour by hour: it relaxes toward the equilibrium set by
# temperature and humidity and jumps with rain, so a short shower or a dry thunderstorm only slows the fire for a few
# hours while a soaking rain stops it for a day. Rothermel's moisture damping turns it into a speed factor.
MOISTURE_EXT = 0.25  # moisture of extinction: the fire stops spreading at this fuel moisture
MOISTURE_LAG_H = 6.0  # drying/wetting time lag (between 1-h and 10-h fuels)
RAIN_WETTING = 0.05  # moisture added per mm of rain
MOISTURE_MAX = 0.6
ETA_MIN = 0.02


def _emc(rh: float, temp_c: float) -> float:
    """Equilibrium moisture content of dead fuel (fraction), Simard (1968)."""
    t = temp_c * 9 / 5 + 32
    if rh < 10:
        m = 0.03229 + 0.281073 * rh - 0.000578 * rh * t
    elif rh < 50:
        m = 2.22749 + 0.160107 * rh - 0.01478 * t
    else:
        m = 21.0606 + 0.005565 * rh * rh - 0.00035 * rh * t - 0.483199 * rh
    return max(0.01, m / 100)


def fuel_moisture(hourly: list[dict]) -> list[float]:
    """Dead fine-fuel moisture at each hour of `hourly` (starts at equilibrium with the first hour)."""
    out, m = [], None
    keep = math.exp(-1 / MOISTURE_LAG_H)
    for w in hourly:
        temp = w.get("temp_c")
        eq = _emc(w["humidity_pct"], 20.0 if temp is None else temp)
        m = eq if m is None else eq + (m - eq) * keep
        m = min(MOISTURE_MAX, m + RAIN_WETTING * (w.get("precip_mm") or 0))
        out.append(m)
    return out


def _damping(moisture: float) -> float:
    r = min(1.0, moisture / MOISTURE_EXT)
    return max(ETA_MIN, 1 - 2.59 * r + 5.11 * r * r - 3.52 * r ** 3)


def _hour_params(w: dict, fuel: float, rain_7d: float, moisture: float) -> tuple[float, ...]:
    """(head ROS m/min, wind-to east, wind-to north, ellipse eccentricity, a, b) for one hour of weather.
    Head ROS in a cell of fuel factor f is (1 + a * f) * b, so a per-cell fuel grid can reuse the hour's numbers."""
    drought = 0.5 + 0.5 * min(1, max(0, (15 - rain_7d) / 15))  # a wet week keeps heavier fuels damp
    wind = w["wind_speed_ms"]
    a, b = 6.0 * drought, (1 + 0.3 * wind) * _damping(moisture)
    to = math.radians((w["wind_from_deg"] + 180) % 360)
    mph = wind * 2.237
    lb = min(3.5, max(1.0, 0.936 * math.exp(0.2566 * mph) + 0.461 * math.exp(-0.1548 * mph) - 0.397))
    return (1.0 + a * fuel) * b, math.sin(to), math.cos(to), math.sqrt(lb * lb - 1) / lb, a, b


def _prepare(lat: float, lon: float, hourly: list[dict], rain_7d: float, fuel_type: str,
             seeds: list[tuple[float, float]] | None, speed: float, grid: tuple | None = None,
             fuel_factors: dict | None = None) -> dict:
    """`grid`: a precomputed `_dem()` result (the calibration benchmark reuses one per fire).
    `fuel_factors`: per land-cover group (ESA WorldCover); the fuel varies cell by cell. Without it, or if the land
    cover can't be read, `fuel_type` applies to the whole grid."""
    dem, cell_m, ox, oy = grid or _dem(lat, lon)
    H, W = dem.shape
    px, py = _merc_px(lat, lon, ZOOM)
    ign = (int((py - oy) / DOWNSAMPLE), int((px - ox) / DOWNSAMPLE))
    fuel = scoring.FUEL.get(fuel_type, 0.7)
    moisture = fuel_moisture(hourly)
    params = [_hour_params(w, fuel, rain_7d, moisture[i]) for i, w in enumerate(hourly)] or [_hour_params(
        {"humidity_pct": 50, "wind_speed_ms": 3, "wind_from_deg": 270}, fuel, rain_7d, _emc(50, 20))]
    params = [(p[0] * speed, *p[1:5], p[5] * speed) for p in params]
    starts = {ign}
    for s_lat, s_lon in seeds or []:
        sx, sy = _merc_px(s_lat, s_lon, ZOOM)
        cell = (int((sy - oy) / DOWNSAMPLE), int((sx - ox) / DOWNSAMPLE))
        if 0 <= cell[0] < H and 0 <= cell[1] < W:
            starts.add(cell)
    ctx = {"dem": dem, "cell_m": cell_m, "ox": ox, "oy": oy, "ign": ign, "params": params, "starts": starts,
           "burnable": dem > 0.5, "fuel_grid": None}
    if fuel_factors:
        try:
            ctx["fuel_grid"] = _fuel_grid(ctx, fuel_factors)
            ctx["burnable"] &= ctx["fuel_grid"] > 0
        except Exception:  # land cover unavailable: keep the single fuel type
            ctx["fuel_grid"] = None
    return ctx


def _fuel_grid(ctx: dict, factors: dict) -> np.ndarray:
    H, W = ctx["dem"].shape
    cols, rows = np.meshgrid(np.arange(W), np.arange(H))
    x = ctx["ox"] + (cols + 0.5) * DOWNSAMPLE
    y = ctx["oy"] + (rows + 0.5) * DOWNSAMPLE
    n = 256 * 2**ZOOM
    lons = x / n * 360 - 180
    lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y / n))))
    cls = landcover.classes(lons, lats, f"z{ZOOM}_{int(ctx['ox'])}_{int(ctx['oy'])}_{H}")
    lut = np.zeros(256, np.float32)
    for c, group in landcover.GROUP.items():
        lut[c] = factors.get(group, 0.0) if group else 0.0
    lut[0] = factors.get("tree", 1.0)  # no WorldCover tile (rare inland gaps): assume forest, the sea is excluded by elevation
    return lut[cls]


def _arrival(ctx: dict, burnable: np.ndarray, horizon_h: float = max(HOURS)) -> np.ndarray:
    """Minimum travel time (minutes) from the starts to every cell, with the weather of each hour."""
    dem, cell_m, params, F = ctx["dem"], ctx["cell_m"], ctx["params"], ctx.get("fuel_grid")
    H, W = dem.shape
    T = np.full((H, W), np.inf)
    pq = []
    for cell in ctx["starts"]:
        T[cell] = 0.0
        pq.append((0.0, *cell))
    horizon = 60 * horizon_h + 1
    moves = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr, dc) != (0, 0)]
    while pq:
        t, r, c = heapq.heappop(pq)
        if t > T[r, c] or t > horizon:
            continue
        r_head, we, wn, ecc, a, b = params[min(int(t // 60), len(params) - 1)]  # weather at the fire's current time
        for dr, dc in moves:
            rr, cc = r + dr, c + dc
            if not (0 <= rr < H and 0 <= cc < W) or not burnable[rr, cc]:
                continue
            east, north = dc, -dr
            dist = math.hypot(east, north)
            cos_d = (east * we + north * wn) / dist
            rise = (dem[rr, cc] - dem[r, c]) / (cell_m * dist)
            slope_mult = 2 ** max(-1.0, min(2.0, math.degrees(math.atan(rise)) / 10))
            head = r_head if F is None else (1.0 + a * F[rr, cc]) * b
            ros = head * slope_mult * (1 - ecc) / (1 - ecc * cos_d)
            nt = t + cell_m * dist / ros
            if nt < T[rr, cc]:
                T[rr, cc] = nt
                heapq.heappush(pq, (nt, rr, cc))
    return T


def _lonlat_fn(ctx: dict):
    def to_lonlat(r: float, c: float) -> list[float]:
        lo, la = _px_to_lonlat(ctx["ox"] + (c + 0.5) * DOWNSAMPLE, ctx["oy"] + (r + 0.5) * DOWNSAMPLE, ZOOM)
        return [round(float(lo), 5), round(float(la), 5)]
    return to_lonlat


def _polygons(mask: np.ndarray, to_lonlat) -> list:
    contours = [c for c in measure.find_contours(np.pad(mask.astype(float), 1), 0.5) if len(c) >= 4]
    polys = []
    for contour in contours:  # several fronts can burn separately (multi-point ignition)
        ring = [to_lonlat(r - 1, c - 1) for r, c in contour]
        ring.append(ring[0])
        polys.append([ring])
    return polys


def _perimeters(T: np.ndarray, ctx: dict, to_lonlat) -> tuple[list, dict]:
    features, areas = [], {}
    cell_ha = ctx["cell_m"] ** 2 / 1e4
    for h in HOURS:
        burned = T <= 60 * h
        areas[str(h)] = round(float(burned.sum()) * cell_ha, 1)
        polys = _polygons(burned, to_lonlat)
        if polys:
            features.append({"type": "Feature", "properties": {"hours": h, "area_ha": areas[str(h)]},
                             "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    return features, areas


def simulate(lat: float, lon: float, hourly: list[dict], rain_7d: float, fuel_type: str = "conifer_forest",
             seeds: list[tuple[float, float]] | None = None, observed: dict | None = None, speed: float = SPEED,
             checkpoints: list[float] | None = None) -> dict:
    """`seeds`: every burning point seen at t=0 (multi-point ignition); defaults to the alert location.
    `checkpoints`: extra hours whose predicted area is returned in `area_at` (to compare with official figures)."""
    started = time.perf_counter()
    ctx = _prepare(lat, lon, hourly, rain_7d, fuel_type, seeds, speed, fuel_factors=FUEL_FACTORS)
    dem, cell_m, ox, oy, ign, params, starts = (ctx[k] for k in ("dem", "cell_m", "ox", "oy", "ign", "params", "starts"))
    T = _arrival(ctx, ctx["burnable"])
    w0 = hourly[0] if hourly else {"wind_from_deg": 270, "wind_speed_ms": 3, "wind_gust_ms": 5}
    we, wn = params[0][1], params[0][2]

    to_lonlat = _lonlat_fn(ctx)
    head = [to_lonlat(*ign)]
    seed_points = [to_lonlat(*c) for c in starts]
    features, areas = _perimeters(T, ctx, to_lonlat)
    cell_ha = cell_m * cell_m / 1e4
    area_at = {str(h): round(float((T <= 60 * h).sum()) * cell_ha, 1) for h in checkpoints or []}
    for h in range(1, max(HOURS) + 1, 2):
        rows, cols = np.nonzero(T <= 60 * h)
        if len(rows):
            proj = (cols - ign[1]) * we + (ign[0] - rows) * wn
            i = int(np.argmax(proj))
            head.append(to_lonlat(rows[i], cols[i]))

    rain_by_horizon, prev = {}, 0
    for h in HOURS:
        rain_by_horizon[str(h)] = round(sum((x.get("precip_mm") or 0) for x in hourly[prev:h]), 1)
        prev = h

    # Prediction vs reality: was each later satellite detection inside the predicted burn area by then?
    hits = {}
    if observed:
        k = VIIRS_TOLERANCE_CELLS
        for h in HOURS:
            pts = [f for f in observed["features"] if f["properties"]["hours_after"] <= h]
            hit = 0
            for f in pts:
                o_lon, o_lat = f["geometry"]["coordinates"]
                sx, sy = _merc_px(o_lat, o_lon, ZOOM)
                r, c = int((sy - oy) / DOWNSAMPLE), int((sx - ox) / DOWNSAMPLE)
                window = T[max(0, r - k): r + k + 1, max(0, c - k): c + k + 1]
                hit += bool(window.size and window.min() <= 60 * h)
            hits[str(h)] = [hit, len(pts)]

    return {
        "ignition": {"lat": lat, "lon": lon},
        "observed_hits": hits,
        "seeds": {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": c}} for c in seed_points]},
        "wind": {"from_deg": w0["wind_from_deg"], "speed_ms": w0["wind_speed_ms"], "gust_ms": w0.get("wind_gust_ms")},
        "weather_hourly": hourly[: max(HOURS) + 1],
        "hours": list(HOURS),
        "perimeters": {"type": "FeatureCollection", "features": features},
        "head_path": {"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": head}},
        "rain_by_horizon": rain_by_horizon,
        "area_at": area_at,
        "stats": {"area_ha": areas, "max_ros_m_min": round(max(p[0] for p in params) * 2, 1),
                  "head_direction_deg": round((w0["wind_from_deg"] + 180) % 360), "cell_m": round(cell_m),
                  "fuel": "ESA WorldCover land cover" if ctx["fuel_grid"] is not None else fuel_type,
                  "weather_hours": len(hourly)},
        "model": "elliptical wind-slope spread with hourly weather and fuel moisture, per-cell land cover, minimum travel time on terrain grid",
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }


def replay_context(lat: float, lon: float, day: str, span: float = 0.2) -> dict:
    """What the satellite saw: the first pass on `day` (seeds, t=0) and every later detection within 48 h."""
    from datetime import datetime, timedelta, timezone

    from .config import REPLAY_SOURCES
    from .sources import fetch_hotspots_multi

    bbox = (lon - span, lat - span, lon + span, lat + span)
    second = (datetime.fromisoformat(day) + timedelta(days=5)).date().isoformat()
    rows = fetch_hotspots_multi(bbox, 5, day, REPLAY_SOURCES) + fetch_hotspots_multi(bbox, 4, second, REPLAY_SOURCES)
    for r in rows:
        r["when"] = datetime.strptime(f"{r['acq_date']} {int(r['acq_time']):04d}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
    if not rows:
        return {"seeds": [], "start_jst": None, "observed": {"type": "FeatureCollection", "features": []}}
    t0 = min(r["when"] for r in rows)
    first_pass = [r for r in rows if (r["when"] - t0).total_seconds() < 3600]
    feats = []
    for r in rows:
        hours_after = (r["when"] - t0).total_seconds() / 3600
        if 1 <= hours_after <= max(HOURS):
            feats.append({"type": "Feature", "properties": {"hours_after": round(hours_after, 1), "frp": float(r["frp"])},
                          "geometry": {"type": "Point", "coordinates": [float(r["longitude"]), float(r["latitude"])]}})
    jst = t0.astimezone(timezone(timedelta(hours=9)))
    return {
        "seeds": [(float(r["latitude"]), float(r["longitude"])) for r in first_pass],
        "start_jst": jst.strftime("%Y-%m-%dT%H:00"),
        "start_label": jst.strftime("%Y-%m-%d %H:%M JST"),
        "observed": {"type": "FeatureCollection", "features": feats},
    }


LEAD_H = 3  # hours a crew needs to cut a control line before the front reaches it
HAND_CREW_KM_H, DOZER_KM_H = 0.3, 1.0
WIND_SHIFT_DEG = 60  # typical line production rates (hand crew vs bulldozer)


def plan(lat: float, lon: float, hourly: list[dict], rain_7d: float, fuel_type: str = "conifer_forest",
         seeds: list[tuple[float, float]] | None = None, at_hour: int = 0, lead_h: int = LEAD_H) -> dict:
    """Response plan decided at `at_hour`: a control line cut where the head and flanks will be `lead_h` hours later,
    then the same weather re-simulated with that line as non-burnable fuel. Returns geometry and with/without numbers."""
    started = time.perf_counter()
    ctx = _prepare(lat, lon, hourly, rain_7d, fuel_type, seeds, SPEED, fuel_factors=FUEL_FACTORS)
    T0 = _arrival(ctx, ctx["burnable"])
    to_lonlat = _lonlat_fn(ctx)
    t_plan, t_line = 60 * at_hour, 60 * (at_hour + lead_h)
    burning = T0 <= t_plan
    inside = T0 <= t_line
    grown = inside.copy()
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            grown |= np.roll(np.roll(inside, dr, axis=0), dc, axis=1)
    ring = grown & ~inside & ctx["burnable"]
    # Head + flanks only: the rear spreads slowly and is held by direct attack from the anchor point.
    # A forecast wind shift turns a flank or the rear into the new head, so then the line encircles the fire.
    _, we, wn, ecc = ctx["params"][min(at_hour, len(ctx["params"]) - 1)][:4]
    window = hourly[at_hour: at_hour + 12]
    dirs = [w["wind_from_deg"] for w in window]
    shift = max((abs((d - dirs[0] + 180) % 360 - 180) for d in dirs), default=0)
    encircle = shift >= WIND_SHIFT_DEG
    rows, cols = np.nonzero(burning if burning.any() else inside)
    cr, cc = rows.mean(), cols.mean()
    rr, rc = np.nonzero(ring)
    east, north = rc - cc, cr - rr
    norm = np.hypot(east, north) + 1e-9
    front = ((east * we + north * wn) / norm >= -0.35) | encircle
    line = np.zeros_like(ring)
    line[rr[front], rc[front]] = True
    T1 = _arrival(ctx, ctx["burnable"] & ~line)

    base_features, base_areas = _perimeters(T0, ctx, to_lonlat)
    plan_features, plan_areas = _perimeters(T1, ctx, to_lonlat)
    line_km = round(float(line.sum()) * ctx["cell_m"] / 1000, 1)
    cell_ha = ctx["cell_m"] ** 2 / 1e4
    return {
        "at_hour": at_hour, "lead_h": lead_h,
        "plan_time": hourly[at_hour]["time"] if at_hour < len(hourly) else None,
        "burning_ha": round(float(burning.sum()) * cell_ha, 1),
        "control_line": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"lead_h": lead_h},
                         "geometry": {"type": "MultiPolygon", "coordinates": _polygons(line, to_lonlat)}}]},
        "with_plan": {"type": "FeatureCollection", "features": plan_features},
        "area_ha": {"no_action": base_areas, "with_plan": plan_areas},
        "line_km": line_km, "line_type": "full perimeter (wind shift)" if encircle else "head and flanks",
        "crews": {"hand_crews": max(1, math.ceil(line_km / (HAND_CREW_KM_H * lead_h))),
                  "bulldozers": max(1, math.ceil(line_km / (DOZER_KM_H * lead_h)))},
        "head_direction_deg": round(math.degrees(math.atan2(we, wn)) % 360),
        "weather_next_12h": {
            "max_wind_ms": max((w["wind_speed_ms"] for w in window), default=None),
            "max_gust_ms": max((w.get("wind_gust_ms") or 0 for w in window), default=None),
            "min_humidity_pct": min((w["humidity_pct"] for w in window), default=None),
            "wind_shift_deg": round(shift),
            "rain_mm": round(sum(w.get("precip_mm") or 0 for w in window), 1),
        },
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }
