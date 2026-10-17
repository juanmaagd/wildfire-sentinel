"""External data: NASA FIRMS hotspots, GSI aerial mosaics, NASA GIBS satellite tiles, Open-Meteo weather."""

import csv
import io
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
from PIL import Image

from .config import IMAGES_DIR, firms_key

FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{bbox}/{days}"
GSI_TILE = "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"
GIBS_SNAPSHOT = "https://wvs.earthdata.nasa.gov/api/v1/snapshot"
TILE = 256


@dataclass(frozen=True)
class Hotspot:
    id: str
    lat: float
    lon: float
    frp: float
    acq_date: str
    acq_time: str
    detections: int = 1

    def as_event(self) -> dict:
        return {"id": self.id, "lat": self.lat, "lon": self.lon, "frp": self.frp,
                "acq_date": self.acq_date, "acq_time": self.acq_time, "detections": self.detections}


class OutsideJapan(Exception):
    """No GSI aerial tile exists for this point."""


def cluster_hotspots(rows: list[dict]) -> list[Hotspot]:
    """Merge detections in the same ~1 km cell; keep the strongest FRP and count detections."""
    cells: dict[tuple[float, float], dict] = {}
    for row in rows:
        key = (round(float(row["latitude"]), 2), round(float(row["longitude"]), 2))
        best = cells.get(key)
        if best is None or float(row["frp"]) > float(best["row"]["frp"]):
            cells[key] = {"row": row, "count": (best or {}).get("count", 0)}
        cells[key]["count"] += 1
    hotspots = [
        Hotspot(
            id=f"{c['row']['acq_date']}_{float(c['row']['latitude']):.4f}_{float(c['row']['longitude']):.4f}",
            lat=float(c["row"]["latitude"]), lon=float(c["row"]["longitude"]), frp=float(c["row"]["frp"]),
            acq_date=c["row"]["acq_date"], acq_time=c["row"]["acq_time"], detections=c["count"],
        )
        for c in cells.values()
    ]
    return sorted(hotspots, key=lambda h: h.frp, reverse=True)


def fetch_hotspots(bbox: tuple[float, float, float, float], days: int, on_date: str | None = None,
                   source: str | None = None) -> list[dict]:
    """Live: last `days` days (NRT). Archive: `days` days starting at `on_date` (standard processing)."""
    source = source or ("VIIRS_NOAA20_SP" if on_date else "VIIRS_NOAA20_NRT")
    url = FIRMS_URL.format(key=firms_key(), source=source, bbox=",".join(map(str, bbox)), days=days)
    if on_date:
        url += f"/{on_date}"
    resp = httpx.get(url, timeout=60)
    resp.raise_for_status()
    if not resp.text.startswith("latitude"):
        raise RuntimeError(f"FIRMS error: {resp.text[:200]}")
    return list(csv.DictReader(io.StringIO(resp.text)))


def _tile_of(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    n = 2**zoom
    lat_rad = math.radians(lat)
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n)


def _center_pixel(lat: float, lon: float, zoom: int) -> tuple[float, float]:
    n = 2**zoom
    lat_rad = math.radians(lat)
    x = (lon + 180) / 360 * n * TILE
    y = (1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n * TILE
    return x, y


def aerial_mosaic(lat: float, lon: float, zoom: int, name: str, size: int = 768) -> Path:
    """GSI orthophoto centered exactly on the point (stitch 4x4 tiles, crop `size` px). Cached on disk."""
    out = IMAGES_DIR / name
    if out.exists():
        return out
    cx, cy = _center_pixel(lat, lon, zoom)
    tx0, ty0 = int(cx // TILE) - 2, int(cy // TILE) - 2
    canvas = Image.new("RGB", (TILE * 4, TILE * 4))
    with httpx.Client(timeout=15) as client:
        for dy in range(4):
            for dx in range(4):
                resp = client.get(GSI_TILE.format(z=zoom, x=tx0 + dx, y=ty0 + dy))
                if resp.status_code == 404:
                    raise OutsideJapan(f"{lat},{lon}")
                resp.raise_for_status()
                canvas.paste(Image.open(io.BytesIO(resp.content)).convert("RGB"), (dx * TILE, dy * TILE))
    px, py = cx - tx0 * TILE, cy - ty0 * TILE
    half = size // 2
    canvas.crop((int(px) - half, int(py) - half, int(px) + half, int(py) + half)).save(out, "JPEG", quality=88)
    return out


def satellite_tile(lat: float, lon: float, day: str, name: str, span_deg: float = 0.25) -> Path | None:
    """VIIRS true color around the point on the detection day (NASA GIBS, no key)."""
    out = IMAGES_DIR / name
    if out.exists():
        return out
    params = {
        "REQUEST": "GetSnapshot", "LAYERS": "VIIRS_NOAA20_CorrectedReflectance_TrueColor", "CRS": "EPSG:4326",
        "TIME": day, "BBOX": f"{lat - span_deg},{lon - span_deg},{lat + span_deg},{lon + span_deg}",
        "FORMAT": "image/jpeg", "WIDTH": 512, "HEIGHT": 512,
    }
    resp = httpx.get(GIBS_SNAPSHOT, params=params, timeout=30)
    if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("image"):
        return None
    out.write_bytes(resp.content)
    return out


def weather(lat: float, lon: float, day: str | None = None) -> dict:
    """Wind, humidity and 7-day rain. Live: current conditions. Replay: historical at 14:00 JST on `day`."""
    common = {"latitude": lat, "longitude": lon, "timezone": "Asia/Tokyo", "wind_speed_unit": "ms",
              "daily": "precipitation_sum"}
    if day is None:
        resp = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=20, params={
            **common, "current": "relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m",
            "past_days": 7, "forecast_days": 1})
        resp.raise_for_status()
        d = resp.json()
        now = d["current"]
        rain = d["daily"]["precipitation_sum"][:-1]
        observed_at = now["time"]
        values = now
    else:
        end = date.fromisoformat(day)
        resp = httpx.get("https://archive-api.open-meteo.com/v1/archive", timeout=20, params={
            **common, "hourly": "relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m",
            "start_date": (end - timedelta(days=7)).isoformat(), "end_date": day})
        resp.raise_for_status()
        d = resp.json()
        observed_at = f"{day}T14:00"
        idx = d["hourly"]["time"].index(observed_at)
        values = {k: v[idx] for k, v in d["hourly"].items()}
        rain = d["daily"]["precipitation_sum"][:-1]
    return {
        "observed_at": observed_at,
        "temperature_c": values["temperature_2m"],
        "humidity_pct": values["relative_humidity_2m"],
        "wind_speed_ms": values["wind_speed_10m"],
        "wind_gust_ms": values["wind_gusts_10m"],
        "wind_from_deg": values["wind_direction_10m"],
        "rain_7d_mm": round(sum(r or 0 for r in rain), 1),
    }


def today() -> str:
    return datetime.now().date().isoformat()


def hourly_weather(lat: float, lon: float, day: str | None, hours: int = 48, start: str | None = None) -> list[dict]:
    """Hourly wind/humidity for the spread model. Replay: archive from `start` (JST "YYYY-MM-DDTHH:00", default
    14:00 on `day`). Live: forecast from now."""
    params = {"latitude": lat, "longitude": lon, "timezone": "Asia/Tokyo", "wind_speed_unit": "ms",
              "hourly": "relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m"}
    if day:
        start = date.fromisoformat(day)
        resp = httpx.get("https://archive-api.open-meteo.com/v1/archive", timeout=30, params={
            **params, "start_date": day, "end_date": (start + timedelta(days=hours // 24 + 1)).isoformat()})
        first = start or f"{day}T14:00"
    else:
        resp = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=30, params={**params, "forecast_days": hours // 24 + 2})
        first = datetime.now().strftime("%Y-%m-%dT%H:00")
    resp.raise_for_status()
    h = resp.json()["hourly"]
    i0 = h["time"].index(first) if first in h["time"] else 0
    return [
        {"time": h["time"][i], "humidity_pct": h["relative_humidity_2m"][i], "wind_speed_ms": h["wind_speed_10m"][i],
         "wind_from_deg": h["wind_direction_10m"][i], "wind_gust_ms": h["wind_gusts_10m"][i]}
        for i in range(i0, min(i0 + hours + 1, len(h["time"])))
        if h["wind_speed_10m"][i] is not None
    ]
