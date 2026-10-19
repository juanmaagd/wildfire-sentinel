"""Orchestration: FIRMS → memory → Jev sentinel (alert immediately) → Jev probe → scores → ai& report.

Every step pushes an event to `emit` as soon as it is done, so the map updates live.
"""

import asyncio
import time
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable

from . import analyst, jev, memory, scoring, sources
from .config import DRILL, JAPAN_BBOX, OFUNATO_BBOX, REPLAY_DAYS, REPLAY_SOURCES, REPLAY_START

Emit = Callable[[str, dict], Awaitable[None]]

# On-demand ai& reports need what the run already computed; kept in process (single-user demo).
HOTSPOTS: dict[str, sources.Hotspot] = {}
ASSESSED: dict[str, dict] = {}  # id -> {"facts", "wide", "assessment"}


def _jst(h: sources.Hotspot) -> str:
    utc = datetime.strptime(f"{h.acq_date} {int(h.acq_time):04d}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
    return utc.astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M JST")


async def assess(h: sources.Hotspot, mem, jv, day: str | None, detections: int) -> tuple[dict, dict]:
    """Jev stage-2 probe + weather + rule scores. Returns (probe event, assessment event) and caches the facts."""
    close = sources.IMAGES_DIR / f"{h.lat:.4f}_{h.lon:.4f}_z16.jpg"
    wide_name, sat_name = f"{h.lat:.4f}_{h.lon:.4f}_z14.jpg", f"{h.lat:.4f}_{h.lon:.4f}_{h.acq_date}_sat.jpg"
    if not close.exists():
        await asyncio.to_thread(sources.aerial_mosaic, h.lat, h.lon, 16, close.name)
    wide, sat = await asyncio.gather(
        asyncio.to_thread(sources.aerial_mosaic, h.lat, h.lon, 14, wide_name),
        asyncio.to_thread(sources.satellite_tile, h.lat, h.lon, h.acq_date, sat_name),
        return_exceptions=True,
    )
    if isinstance(wide, BaseException):
        raise wide
    if isinstance(sat, BaseException):  # satellite context is optional; flaky networks shouldn't drop the analysis
        sat = None
    flat, detail, ms = await jev.probe(jv, close, wide, sat)
    probe_event = {"id": h.id, "answers": detail, "latency_ms": ms,
                   "images": {"close": _img(close.name), "wide": _img(wide_name), "satellite": _img(sat_name) if sat else None}}
    wx = await asyncio.to_thread(sources.weather, h.lat, h.lon, day)
    scores = scoring.score(flat, wx, {"frp": h.frp, "detections": detections})
    actions = scoring.recommended_actions(scores, flat)
    facts = {
        # Only the JST time is given, so the model can't mix it up with the raw UTC acquisition time.
        "hotspot": {"lat": h.lat, "lon": h.lon, "frp_mw": h.frp, "detected_at": _jst(h),
                    "detections_in_area_this_pass": detections},
        # Labels, not raw scale positions: the model must not read "2.9" as a quantity.
        "jev_probe": {k: v.get("label", v["value"]) for k, v in detail.items()},
        "weather": wx,
        "scores_1_to_5": {k: scores[k] for k in ("danger", "spread_risk", "exposure", "urgency")},
        "score_factors_0_to_1": scores["factors"],
        "houses_downwind": scores["downwind"],
        "memory_known_sites_within_5km": await memory.history(mem, h.lat, h.lon),
        "recommended_actions_from_rules": actions,
    }
    assessment = {
        "id": h.id, "scores": {k: scores[k] for k in ("danger", "spread_risk", "exposure", "urgency")},
        "confidence": scores["confidence"], "downwind": scores["downwind"], "factors": scores["factors"],
        "recommended_actions": actions, "weather": wx, "detected_at": _jst(h), "brief_pending": True,
    }
    await memory.remember_report(mem, h, scores, "rules", ms)
    ASSESSED[h.id] = {"facts": facts, "wide": wide, "assessment": assessment, "probe": probe_event}
    return probe_event, assessment


async def _ensure_assessed(hotspot_id: str) -> dict:
    if hotspot_id not in ASSESSED:
        h = HOTSPOTS[hotspot_id]
        day = None if hotspot_id.startswith("drill_") or h.acq_date == sources.today() else h.acq_date
        async with memory.client() as mem, jev.client() as jv:
            await assess(h, mem, jv, day, h.detections)
    return ASSESSED[hotspot_id]


async def probe_on_demand(hotspot_id: str) -> dict:
    """Jev deep probe + rule scores for an alert the run did not analyse (only the strongest per batch is automatic)."""
    cached = await _ensure_assessed(hotspot_id)
    return {"probe": cached["probe"], "report": cached["assessment"]}


async def report_on_demand(hotspot_id: str) -> dict:
    """ai& situation report for one alert, only when a user asks for it."""
    cached = await _ensure_assessed(hotspot_id)
    rep, model, rep_ms = await analyst.report(cached["facts"], cached["wide"])
    report = {**cached["assessment"], **rep, "brief_pending": False, "model": model, "latency_ms": rep_ms,
              "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    return {"probe": cached["probe"], "report": report}
PROBE_CONCURRENCY = 4  # every alert gets the deep probe; GSI/GIBS/Open-Meteo are public, so keep it gentle
LIVE_MAX = 150  # live "this view": a wide view (a continent) has thousands of hotspots; triage the strongest
JEV_CONCURRENCY = 8


def _img(name: str) -> str:
    return f"/api/images/{name}"


class Run:
    def __init__(self, mode: str, emit: Emit, bbox: tuple[float, float, float, float] = JAPAN_BBOX):
        self.mode, self.emit, self.bbox = mode, emit, bbox
        self.stats = {"mode": mode, "total": 0, "in_japan": 0, "filtered_industrial": 0, "memory_hits": 0,
                      "alerts": 0, "jev_calls": 0, "reports": 0, "elapsed_s": 0.0}
        self.started = time.perf_counter()
        self.background: list[asyncio.Task] = []
        self.probe_sem = asyncio.Semaphore(PROBE_CONCURRENCY)

    async def summary(self) -> None:
        self.stats["elapsed_s"] = round(time.perf_counter() - self.started, 1)
        await self.emit("summary", dict(self.stats))

    async def triage_one(self, h: sources.Hotspot, mem, jv, sem) -> sources.Hotspot | None:
        try:
            return await self._triage_one(h, mem, jv, sem)
        except Exception as exc:  # one bad hotspot must not stop the run
            await self.emit("triage", {"id": h.id, "verdict": "error", "source": "error", "confidence": 0,
                                       "signals": {}, "latency_ms": 0, "image_url": None, "error": str(exc)})
            return None

    async def _triage_one(self, h: sources.Hotspot, mem, jv, sem) -> sources.Hotspot | None:
        HOTSPOTS[h.id] = h
        await self.emit("hotspot", h.as_event())
        known = await memory.lookup(mem, h.lat, h.lon)
        if known:
            self.stats["memory_hits"] += 1
            self.stats["in_japan"] += 1
            verdict = known.get("verdict", "other")
            await self.emit("triage", {"id": h.id, "verdict": verdict, "source": "memory", "confidence": known.get("confidence"),
                                       "memory": known, "signals": {}, "latency_ms": 0,
                                       "image_url": _img(known["image"]) if known.get("image") else None})
        else:
            close = f"{h.lat:.4f}_{h.lon:.4f}_z16.jpg"
            try:
                path = await asyncio.to_thread(sources.aerial_mosaic, h.lat, h.lon, 16, close)
            except sources.NoImagery:
                await self.emit("triage", {"id": h.id, "verdict": "outside", "source": "gsi", "confidence": 1.0,
                                           "signals": {}, "latency_ms": 0, "image_url": None})
                return None
            self.stats["in_japan"] += 1
            async with sem:
                signals, ms = await jev.sentinel(jv, path)
            self.stats["jev_calls"] += 1
            verdict, confidence = scoring.classify(signals)
            await self.emit("triage", {"id": h.id, "verdict": verdict, "source": "jev", "confidence": round(confidence, 2),
                                       "signals": signals, "latency_ms": ms, "image_url": _img(close)})
            await memory.remember_triage(mem, h, verdict, confidence, signals, ms)
        if verdict == "industrial":
            self.stats["filtered_industrial"] += 1
        if verdict == "possible_fire":
            self.stats["alerts"] += 1
            return h
        return None

    async def analyse(self, h: sources.Hotspot, mem, jv, day: str | None, batch_detections: int) -> None:
        """Automatic, cheap part: Jev deep probe + rule-based scores. The ai& report is on demand."""
        probe_event, assessment = await assess(h, mem, jv, day, batch_detections)
        self.stats["jev_calls"] += 1
        await self.emit("probe", probe_event)
        await self.emit("report", assessment)

    async def batch(self, hotspots: list[sources.Hotspot], mem, jv, day: str | None) -> None:
        self.stats["total"] += len(hotspots)
        sem = asyncio.Semaphore(JEV_CONCURRENCY)
        alerts = [a for a in await asyncio.gather(*(self.triage_one(h, mem, jv, sem) for h in hotspots)) if a]
        await self.summary()
        # Replay: the batch is one fire on one day, so its detection count describes the fire. Live: the batch is
        # all of Japan, so each alert counts only its own detections.
        total = sum(h.detections for h in hotspots)
        # Alerts are already on the map; deep analysis runs in the background (strongest first) so the next batch
        # isn't blocked.
        for h in sorted(alerts, key=lambda a: a.frp, reverse=True):
            detections = total if self.mode == "replay" else h.detections
            self.background.append(asyncio.create_task(self._analyse_safe(h, mem, jv, day, detections)))

    async def _analyse_safe(self, h, mem, jv, day, detections) -> None:
        try:
            async with self.probe_sem:
                await self.analyse(h, mem, jv, day, detections)
        except Exception as exc:
            await self.emit("analysis_error", {"id": h.id, "message": f"{type(exc).__name__}: {exc}"})
        await self.summary()

    async def run(self) -> None:
        async with memory.client() as mem, jev.client() as jv:
            if self.mode == "replay":
                await asyncio.to_thread(memory.forget_area, OFUNATO_BBOX)
                start = date.fromisoformat(REPLAY_START)
                end = (start + timedelta(days=REPLAY_DAYS - 1)).isoformat()
                rain = await asyncio.to_thread(sources.daily_rain, 39.05, 141.8, REPLAY_START, end)
                for i in range(REPLAY_DAYS):
                    day = (start + timedelta(days=i)).isoformat()
                    rows = await asyncio.to_thread(sources.fetch_hotspots_multi, OFUNATO_BBOX, 1, day, REPLAY_SOURCES)
                    await self.emit("day", {"date": day, "index": i + 1, "of": REPLAY_DAYS,
                                            "detections": len(rows), "rain_mm": round(rain.get(day, 0.0), 1)})
                    await self.batch(sources.cluster_hotspots(rows), mem, jv, day)
                    await asyncio.sleep(1.2)  # pacing so the audience can follow day by day
            elif self.mode == "drill":
                lat, lon = DRILL["lat"], DRILL["lon"]
                await asyncio.to_thread(memory.forget_area, (lon - 0.02, lat - 0.02, lon + 0.02, lat + 0.02))
                now = datetime.now(timezone.utc)
                h = sources.Hotspot(id=f"drill_{now:%H%M%S}_{lat:.4f}_{lon:.4f}", lat=lat, lon=lon, frp=DRILL["frp"],
                                    acq_date=now.date().isoformat(), acq_time=now.strftime("%H%M"),
                                    detections=DRILL["detections"])
                await self.batch([h], mem, jv, None)
            else:
                rows = await asyncio.to_thread(sources.fetch_hotspots, self.bbox, 2)
                hotspots = sources.cluster_hotspots(rows)  # strongest FRP first
                self.stats["skipped_weak"] = max(0, len(hotspots) - LIVE_MAX)
                await self.batch(hotspots[:LIVE_MAX], mem, jv, None)
            await asyncio.gather(*self.background)
        await self.summary()
        await self.emit("done", {})
