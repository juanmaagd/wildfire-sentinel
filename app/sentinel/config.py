"""Environment and paths. Secrets come from the repo-root .env; nothing is hardcoded except the local dev DB."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

CACHE_DIR = Path(__file__).resolve().parents[1] / ".cache"
IMAGES_DIR = CACHE_DIR / "images"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

JAPAN_BBOX = (128.0, 30.0, 146.0, 46.0)  # west, south, east, north
OFUNATO_BBOX = (141.5, 38.9, 142.0, 39.2)
REPLAY_START = "2025-02-26"
REPLAY_DAYS = 9  # 2025-02-26 → 03-06: ignition, growth, decline, extinguished by the 03-05 rain
# Combining the three VIIRS satellites shows the whole fire lifecycle (NOAA-20 alone misses 03-02..03-04).
REPLAY_SOURCES = ("VIIRS_NOAA20_SP", "VIIRS_SNPP_SP", "VIIRS_NOAA21_NRT")

# Drill: an everyday wildland-urban fire — a small brush fire on the forested slope right above
# central Ashikaga (site of the 2021 Mt. Ryogai fire), run with today's live weather forecast.
DRILL = {"lat": 36.3427, "lon": 139.4462, "frp": 8.5, "detections": 2, "place": "Ashikaga · Mt. Ryogai foothills"}

LOCAL_NEO4J = {"uri": "bolt://localhost:7687", "username": "neo4j", "password": "wildfire-local-dev"}  # docker-compose.yml


def firms_key() -> str:
    return os.environ.get("FIRMS_MAP_KEY") or os.environ["MAP_KEYS"]


def aiand_key() -> str:
    return os.environ["AIAND_API_KEY"]


def neo4j_config() -> dict:
    """Use .env credentials only when the full set is present; otherwise the local Docker instance."""
    env = {k: os.environ.get(f"NEO4J_{k.upper()}") for k in LOCAL_NEO4J}
    return env if all(env.values()) else LOCAL_NEO4J
