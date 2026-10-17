"""AI video of a spread prediction: MiniMax H3 on ai&, anchored on two frames rendered from our own 3D model.

The first frame is the real terrain at ignition and the last frame is the predicted burn area at the chosen hour,
both from the same camera; the video model only animates between them (smoke, flames, motion).
Jobs take minutes, so they run async and finished clips are cached per scenario for the demo.
"""

import json
import time

import httpx

from .config import CACHE_DIR, IMAGES_DIR, aiand_key

API = "https://api.aiand.com/v1"
MODEL = "minimaxai/minimax-h3"
RETRIES = 2  # moderation blocks are not billed and not deterministic: resubmit a blocked clip
SECONDS = 5  # per segment; three segments anchored on our keyframes
INDEX = CACHE_DIR / "videos.json"  # scenario key -> list of jobs (pre-generated clips survive restarts)

COMPASS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast",
           "south-southeast", "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest",
           "northwest", "north-northwest"]
FUEL = {"conifer_forest": "dense conifer forest", "broadleaf_or_mixed_forest": "mixed broadleaf forest",
        "grass_or_shrub": "dry grass and shrubland", "farmland": "farmland", "built_up_or_bare": "sparse vegetation"}


def _h() -> dict:
    return {"Authorization": f"Bearer {aiand_key()}"}


def compass(deg: float) -> str:
    return COMPASS[round((deg % 360) / 22.5) % 16]


def prompt(h0: int, h1: int, head_deg: float, wind_ms: float, fuel: str, area_ha: float) -> str:
    # Framed as what it is, a visualization of our simulation: ai& moderation rejects photorealistic disaster footage
    # of a real, identifiable place (measured), and a simulation look is also the honest presentation. Effects are kept
    # small and inside our outline: a bigger plume made the model invent burn scars and cover the map (measured).
    return (
        f"3D simulation visualization of a fire spread model on real terrain, for a fire department training briefing, "
        f"from hour {h0} to hour {h1} ({FUEL.get(fuel, 'forest')}). The camera stays fixed. Bright flickering flames are "
        f"clearly visible along the whole orange fire front line during the entire clip, and a thin translucent smoke haze drifts low toward the "
        f"{compass(head_deg)} in a {wind_ms:.0f} m/s wind; the map stays clearly visible. The dark burned area grows "
        f"only inside the outline of the last frame (about {area_ha:.0f} hectares) and matches it exactly at the end; "
        f"no burning anywhere else. Keep the terrain, rivers, roads and town unchanged. No text."
    )


def _load() -> dict:
    return json.loads(INDEX.read_text()) if INDEX.exists() else {}


def _save(index: dict) -> None:
    INDEX.write_text(json.dumps(index, indent=1))


def _upload(client: httpx.Client, data: bytes, name: str) -> str:
    r = client.post(f"{API}/files", headers=_h(), data={"purpose": "vision"}, files={"file": (name, data, "image/png")})
    r.raise_for_status()
    return r.json()["id"]


def _submit(client: httpx.Client, seg: dict) -> None:
    """Create the job for one segment; ai& allows few concurrent video jobs, so a 429 leaves it pending."""
    r = client.post(f"{API}/videos", headers=_h(), json={
        "model": MODEL, "prompt": seg["prompt"], "seconds": SECONDS, "aspect_ratio": "16:9",
        "image_reference": [{"file_id": seg["first"], "role": "first_frame"}, {"file_id": seg["last"], "role": "last_frame"}],
    })
    if r.status_code == 429:
        return
    r.raise_for_status()
    job = r.json()
    seg.update(id=job["id"], status=job["status"], cost=job.get("cost"))


def start(scenario: str, frames: list[bytes], hours: list[int], areas: list[float], head_deg: float, wind_ms: float,
          fuel: str) -> dict:
    """One clip per pair of consecutive keyframes (every keyframe is rendered by our model), played back in order."""
    group = f"vid{int(time.time())}"
    for i, f in enumerate(frames):  # keep the keyframes: they are what the video model was anchored on
        (IMAGES_DIR / f"{group}_kf{i}.png").write_bytes(f)
    with httpx.Client(timeout=60) as client:
        ids = [_upload(client, f, f"frame{i}.png") for i, f in enumerate(frames)]
        segments = [{"id": None, "from_h": hours[i], "to_h": hours[i + 1], "status": "pending", "cost": None,
                     "url": None, "error": None, "first": ids[i], "last": ids[i + 1],
                     "prompt": prompt(hours[i], hours[i + 1], head_deg, wind_ms, fuel, areas[i + 1])}
                    for i in range(len(frames) - 1)]
        for seg in segments:
            _submit(client, seg)
    entry = {"id": group, "hours": hours, "keyframes": [f"/api/images/{group}_kf{i}.png" for i in range(len(frames))],
             "segments": segments, "status": "in_progress", "created": int(time.time())}
    index = _load()
    index.setdefault(scenario, []).append(entry)
    _save(index)
    return entry


def poll(group_id: str) -> dict:
    """Refresh every clip of one video, submit pending ones, download each MP4 once it is completed."""
    index = _load()
    entry = next((e for jobs in index.values() for e in jobs if e["id"] == group_id), None)
    if entry is None:
        raise KeyError(group_id)
    with httpx.Client(timeout=120) as client:
        for seg in entry["segments"]:
            if seg["url"] or seg["status"] == "failed":
                continue
            if seg["id"] is None:
                _submit(client, seg)
                continue
            r = client.get(f"{API}/videos/{seg['id']}", headers=_h())
            r.raise_for_status()
            job = r.json()
            seg["status"], seg["error"] = job["status"], job.get("error")
            if job["status"] == "failed" and (job.get("error") or {}).get("code") in ("moderation_blocked", "moderation_unavailable") \
                    and seg.get("retries", 0) < RETRIES:
                seg.update(id=None, status="pending", retries=seg.get("retries", 0) + 1)
                _submit(client, seg)
                continue
            if job["status"] == "completed":
                out = IMAGES_DIR / f"{seg['id']}.mp4"
                if not out.exists():
                    c = client.get(f"{API}/videos/{seg['id']}/content", headers=_h(), follow_redirects=True)
                    c.raise_for_status()
                    out.write_bytes(c.content)
                seg["url"] = f"/api/images/{out.name}"
    done = [seg for seg in entry["segments"] if seg["url"] or seg["status"] == "failed"]
    if len(done) < len(entry["segments"]):
        entry["status"] = "in_progress"
    else:  # the player shows every clip that rendered; a blocked one is skipped
        entry["status"] = "completed" if any(seg["url"] for seg in entry["segments"]) else "failed"
    _save(index)
    return entry


def listing(scenario: str) -> list[dict]:
    return _load().get(scenario, [])
