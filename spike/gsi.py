"""Fetch a GSI aerial photo mosaic centered on a lat/lon (Jev needs >= 280 px per side)."""

import io
import math
from pathlib import Path

import httpx
from PIL import Image

TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"
TILE_SIZE = 256


def tile_of(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    n = 2**zoom
    x = int((lon + 180) / 360 * n)
    lat_rad = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n)
    return x, y


def aerial_mosaic(lat: float, lon: float, out: Path, zoom: int = 16, radius: int = 1) -> Path:
    """Stitch (2*radius+1)^2 tiles around the point into one JPEG."""
    cx, cy = tile_of(lat, lon, zoom)
    side = (2 * radius + 1) * TILE_SIZE
    mosaic = Image.new("RGB", (side, side))
    with httpx.Client(timeout=10) as client:
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                resp = client.get(TILE_URL.format(z=zoom, x=cx + dx, y=cy + dy))
                resp.raise_for_status()
                tile = Image.open(io.BytesIO(resp.content)).convert("RGB")
                mosaic.paste(tile, ((dx + radius) * TILE_SIZE, (dy + radius) * TILE_SIZE))
    mosaic.save(out, "JPEG", quality=90)
    return out
