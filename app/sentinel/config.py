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
REPLAY_DAYS = 4

LOCAL_NEO4J = {"uri": "bolt://localhost:7687", "username": "neo4j", "password": "wildfire-local-dev"}  # docker-compose.yml


def firms_key() -> str:
    return os.environ.get("FIRMS_MAP_KEY") or os.environ["MAP_KEYS"]


def aiand_key() -> str:
    return os.environ["AIAND_API_KEY"]


def neo4j_config() -> dict:
    """Use .env credentials only when the full set is present; otherwise the local Docker instance."""
    env = {k: os.environ.get(f"NEO4J_{k.upper()}") for k in LOCAL_NEO4J}
    return env if all(env.values()) else LOCAL_NEO4J
