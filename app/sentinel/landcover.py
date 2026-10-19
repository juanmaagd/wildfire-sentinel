"""Land cover for the spread model: ESA WorldCover 2021 (10 m, global, CC BY 4.0), read by window from its public
cloud-optimized GeoTIFFs and sampled at the centre of every spread-grid cell. Cached per grid on disk."""

import math

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

from .config import CACHE_DIR

URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
RES_DEG = 0.0008  # ~90 m read resolution (mode of the 10 m classes), then nearest to each ~180 m cell
GDAL_ENV = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif", "GDAL_HTTP_MAX_RETRY": "3"}
CACHE = CACHE_DIR / "landcover"

# WorldCover class -> fuel group used by the spread model; None doesn't burn.
GROUP = {10: "tree", 20: "shrub", 30: "grass", 40: "crop", 50: "built", 60: "bare", 70: None, 80: None,
         90: "wetland", 95: "wetland", 100: "grass"}


def _tile(lat0: int, lon0: int) -> str:
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}{'E' if lon0 >= 0 else 'W'}{abs(lon0):03d}"


def _mosaic(west: float, south: float, east: float, north: float) -> np.ndarray:
    """WorldCover classes over a lon/lat box at RES_DEG (0 where no tile exists, e.g. open sea)."""
    W, H = math.ceil((east - west) / RES_DEG), math.ceil((north - south) / RES_DEG)
    out = np.zeros((H, W), np.uint8)
    with rasterio.Env(**GDAL_ENV):
        for lat0 in range(math.floor(south / 3) * 3, math.ceil(north / 3) * 3, 3):
            for lon0 in range(math.floor(west / 3) * 3, math.ceil(east / 3) * 3, 3):
                w, s, e, n = max(west, lon0), max(south, lat0), min(east, lon0 + 3), min(north, lat0 + 3)
                if w >= e or s >= n:
                    continue
                try:
                    src = rasterio.open(URL.format(tile=_tile(lat0, lon0)))
                except rasterio.errors.RasterioIOError:  # no tile: ocean
                    continue
                with src:
                    c0, r0 = round((w - west) / RES_DEG), round((north - n) / RES_DEG)
                    c1, r1 = round((e - west) / RES_DEG), round((north - s) / RES_DEG)
                    if c1 <= c0 or r1 <= r0:
                        continue
                    out[r0:r1, c0:c1] = src.read(1, window=from_bounds(w, s, e, n, src.transform),
                                                 out_shape=(r1 - r0, c1 - c0), resampling=Resampling.mode)
    return out


def classes(lons: np.ndarray, lats: np.ndarray, key: str) -> np.ndarray:
    """WorldCover class at each (lon, lat) cell centre; `key` names the disk cache entry (one per spread grid)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{key}.npy"
    if path.exists():
        return np.load(path)
    west, east, south, north = lons.min() - RES_DEG, lons.max() + RES_DEG, lats.min() - RES_DEG, lats.max() + RES_DEG
    grid = _mosaic(west, south, east, north)
    r = np.clip(((north - lats) / RES_DEG).astype(int), 0, grid.shape[0] - 1)
    c = np.clip(((lons - west) / RES_DEG).astype(int), 0, grid.shape[1] - 1)
    out = grid[r, c]
    np.save(path, out)
    return out
