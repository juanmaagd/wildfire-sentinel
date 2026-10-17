"""Fire spread prediction: elliptical wind-driven rate of spread + slope, minimum travel time on a terrain grid.

Terrain: AWS Terrain Tiles (terrarium), z12 3x3 mosaic (~23 km), downsampled to ~90 m cells. Sea (elev <= 0) doesn't burn.
Output: perimeters at +1/+3/+6 h as GeoJSON, head path, burned area.
"""

import heapq
import io
import math
import time

import httpx
import numpy as np
from PIL import Image
from skimage import measure

from . import scoring

TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM, TILES, DOWNSAMPLE = 12, 3, 3
HOURS = (1, 3, 6)
EARTH = 40075016.686


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
    """Returns (elevation grid, cell size m, origin x px, origin y px) at ZOOM in global pixel space."""
    px, py = _merc_px(lat, lon, ZOOM)
    tx0, ty0 = int(px // 256) - TILES // 2, int(py // 256) - TILES // 2
    grid = np.zeros((256 * TILES, 256 * TILES), dtype=np.float32)
    with httpx.Client(timeout=20) as client:
        for dy in range(TILES):
            for dx in range(TILES):
                r = client.get(TERRARIUM.format(z=ZOOM, x=tx0 + dx, y=ty0 + dy))
                r.raise_for_status()
                rgb = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), dtype=np.float32)
                grid[dy * 256:(dy + 1) * 256, dx * 256:(dx + 1) * 256] = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
    h = grid.shape[0] // DOWNSAMPLE
    grid = grid[: h * DOWNSAMPLE, : h * DOWNSAMPLE].reshape(h, DOWNSAMPLE, h, DOWNSAMPLE).mean(axis=(1, 3))
    cell_m = EARTH * math.cos(math.radians(lat)) / (256 * 2**ZOOM) * DOWNSAMPLE
    return grid, cell_m, tx0 * 256.0, ty0 * 256.0


def simulate(lat: float, lon: float, weather: dict, fuel_type: str = "conifer_forest") -> dict:
    started = time.perf_counter()
    dem, cell_m, ox, oy = _dem(lat, lon)
    H, W = dem.shape
    px, py = _merc_px(lat, lon, ZOOM)
    ign = (int((py - oy) / DOWNSAMPLE), int((px - ox) / DOWNSAMPLE))

    fuel = scoring.FUEL.get(fuel_type, 0.7)
    dryness = 0.5 * min(1, max(0, (70 - weather["humidity_pct"]) / 45)) + 0.5 * min(1, max(0, (15 - weather["rain_7d_mm"]) / 15))
    wind = weather["wind_speed_ms"]

    gy, gx = np.gradient(dem, cell_m)
    to = math.radians((weather["wind_from_deg"] + 180) % 360)
    we, wn = math.sin(to), math.cos(to)
    # Base ROS (m/min) from fuel and dryness, wind multiplier, slope: ~doubles per 10° upslope along the wind.
    r0 = 1.0 + 6.0 * fuel * dryness
    r_head = r0 * (1 + 0.3 * wind)
    lb = max(1.0, 0.936 * math.exp(0.2566 * wind * 2.237) + 0.461 * math.exp(-0.1548 * wind * 2.237) - 0.397)
    lb = min(lb, 3.5)
    ecc = math.sqrt(lb * lb - 1) / lb

    burnable = dem > 0.5
    T = np.full((H, W), np.inf)
    T[ign] = 0.0
    horizon = 60 * max(HOURS) + 1
    pq = [(0.0, *ign)]
    moves = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr, dc) != (0, 0)]
    while pq:
        t, r, c = heapq.heappop(pq)
        if t > T[r, c] or t > horizon:
            continue
        for dr, dc in moves:
            rr, cc = r + dr, c + dc
            if not (0 <= rr < H and 0 <= cc < W) or not burnable[rr, cc]:
                continue
            east, north = dc, -dr
            dist = math.hypot(east, north)
            cos_d = (east * we + north * wn) / dist
            rise = (dem[rr, cc] - dem[r, c]) / (cell_m * dist)
            slope_mult = 2 ** max(-1.0, min(2.0, math.degrees(math.atan(rise)) / 10))
            ros = r_head * slope_mult * (1 - ecc) / (1 - ecc * cos_d)
            nt = t + cell_m * dist / ros
            if nt < T[rr, cc]:
                T[rr, cc] = nt
                heapq.heappush(pq, (nt, rr, cc))

    def to_lonlat(r: float, c: float) -> list[float]:
        lo, la = _px_to_lonlat(ox + (c + 0.5) * DOWNSAMPLE, oy + (r + 0.5) * DOWNSAMPLE, ZOOM)
        return [round(float(lo), 5), round(float(la), 5)]

    features, areas, head = [], {}, [to_lonlat(*ign)]
    cell_ha = cell_m * cell_m / 1e4
    for h in HOURS:
        burned = T <= 60 * h
        areas[str(h)] = round(float(burned.sum()) * cell_ha, 1)
        contours = measure.find_contours(np.pad(burned.astype(float), 1), 0.5)
        if not contours:
            continue
        ring = [to_lonlat(r - 1, c - 1) for r, c in max(contours, key=len)]
        ring.append(ring[0])
        features.append({"type": "Feature", "properties": {"hours": h, "area_ha": areas[str(h)]},
                         "geometry": {"type": "Polygon", "coordinates": [ring]}})
    for h in range(1, max(HOURS) + 1):
        rows, cols = np.nonzero(T <= 60 * h)
        if len(rows):
            proj = (cols - ign[1]) * we + (ign[0] - rows) * wn
            i = int(np.argmax(proj))
            head.append(to_lonlat(rows[i], cols[i]))

    return {
        "ignition": {"lat": lat, "lon": lon},
        "wind": {"from_deg": weather["wind_from_deg"], "speed_ms": wind, "gust_ms": weather["wind_gust_ms"]},
        "weather": weather,
        "hours": list(HOURS),
        "perimeters": {"type": "FeatureCollection", "features": features},
        "head_path": {"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": head}},
        "stats": {"area_ha": areas, "max_ros_m_min": round(r_head * 2, 1),
                  "head_direction_deg": round((weather["wind_from_deg"] + 180) % 360), "cell_m": round(cell_m),
                  "fuel": fuel_type, "dryness": round(dryness, 2), "length_to_breadth": round(lb, 2)},
        "model": "elliptical wind-slope spread, minimum travel time on terrain grid",
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }
