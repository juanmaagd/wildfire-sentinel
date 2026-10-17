"""Orchestration: FIRMS → memory → Jev sentinel (alert immediately) → Jev probe → scores → ai& report.

Every step pushes an event to `emit` as soon as it is done, so the map updates live.
"""

import asyncio
import time
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable

from . import analyst, jev, memory, scoring, sources
from .config import JAPAN_BBOX, OFUNATO_BBOX, REPLAY_DAYS, REPLAY_START

Emit = Callable[[str, dict], Awaitable[None]]
MAX_REPORTS_PER_BATCH = 1
JEV_CONCURRENCY = 8


def _img(name: str) -> str:
    return f"/api/images/{name}"


class Run:
    def __init__(self, mode: str, emit: Emit):
        self.mode, self.emit = mode, emit
        self.stats = {"mode": mode, "total": 0, "in_japan": 0, "filtered_industrial": 0, "memory_hits": 0,
                      "alerts": 0, "jev_calls": 0, "reports": 0, "elapsed_s": 0.0}
        self.started = time.perf_counter()
        self.background: list[asyncio.Task] = []

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
            except sources.OutsideJapan:
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
        close = sources.IMAGES_DIR / f"{h.lat:.4f}_{h.lon:.4f}_z16.jpg"
        wide_name, sat_name = f"{h.lat:.4f}_{h.lon:.4f}_z14.jpg", f"{h.lat:.4f}_{h.lon:.4f}_{h.acq_date}_sat.jpg"
        wide, sat = await asyncio.gather(
            asyncio.to_thread(sources.aerial_mosaic, h.lat, h.lon, 14, wide_name),
            asyncio.to_thread(sources.satellite_tile, h.lat, h.lon, h.acq_date, sat_name),
        )
        flat, detail, ms = await jev.probe(jv, close, wide, sat)
        self.stats["jev_calls"] += 1
        await self.emit("probe", {"id": h.id, "answers": detail, "latency_ms": ms,
                                  "images": {"close": _img(close.name), "wide": _img(wide_name), "satellite": _img(sat_name) if sat else None}})

        wx = await asyncio.to_thread(sources.weather, h.lat, h.lon, day)
        firms = {"frp": h.frp, "detections": batch_detections}
        scores = scoring.score(flat, wx, firms)
        actions = scoring.recommended_actions(scores, flat)
        facts = {
            "hotspot": {**h.as_event(), "detections_in_area_this_pass": batch_detections, "frp_unit": "MW",
                        "acq_time_utc": h.acq_time},
            # Labels, not raw scale positions: the model must not read "2.9" as a quantity.
            "jev_probe": {k: v.get("label", v["value"]) for k, v in detail.items()},
            "weather": wx,
            "scores_1_to_5": {k: scores[k] for k in ("danger", "spread_risk", "exposure", "urgency")},
            "score_factors_0_to_1": scores["factors"],
            "houses_downwind": scores["downwind"],
            "memory_known_sites_within_5km": await memory.history(mem, h.lat, h.lon),
            "recommended_actions_from_rules": actions,
        }
        rep, model, rep_ms = await analyst.report(facts, wide)
        self.stats["reports"] += 1
        await memory.remember_report(mem, h, scores, model, rep_ms)
        await self.emit("report", {
            "id": h.id, **rep,
            "scores": {k: scores[k] for k in ("danger", "spread_risk", "exposure", "urgency")},
            "confidence": scores["confidence"], "downwind": scores["downwind"], "factors": scores["factors"],
            "recommended_actions": actions, "weather": wx, "model": model, "latency_ms": rep_ms,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })

    async def batch(self, hotspots: list[sources.Hotspot], mem, jv, day: str | None) -> None:
        self.stats["total"] += len(hotspots)
        sem = asyncio.Semaphore(JEV_CONCURRENCY)
        alerts = [a for a in await asyncio.gather(*(self.triage_one(h, mem, jv, sem) for h in hotspots)) if a]
        await self.summary()
        detections = sum(h.detections for h in hotspots)
        # Alerts are already on the map; deep analysis runs in the background so the next batch isn't blocked.
        for h in sorted(alerts, key=lambda a: a.frp, reverse=True)[:MAX_REPORTS_PER_BATCH]:
            self.background.append(asyncio.create_task(self._analyse_safe(h, mem, jv, day, detections)))

    async def _analyse_safe(self, h, mem, jv, day, detections) -> None:
        try:
            await self.analyse(h, mem, jv, day, detections)
        except Exception as exc:
            await self.emit("analysis_error", {"id": h.id, "message": f"{type(exc).__name__}: {exc}"})
        await self.summary()

    async def run(self) -> None:
        async with memory.client() as mem, jev.client() as jv:
            if self.mode == "replay":
                await asyncio.to_thread(memory.forget_area, OFUNATO_BBOX)
                start = date.fromisoformat(REPLAY_START)
                for i in range(REPLAY_DAYS):
                    day = (start + timedelta(days=i)).isoformat()
                    await self.emit("day", {"date": day, "index": i + 1, "of": REPLAY_DAYS})
                    rows = await asyncio.to_thread(sources.fetch_hotspots, OFUNATO_BBOX, 1, day)
                    await self.batch(sources.cluster_hotspots(rows), mem, jv, day)
                    await asyncio.sleep(2)  # pacing so the audience can follow day by day
            else:
                rows = await asyncio.to_thread(sources.fetch_hotspots, JAPAN_BBOX, 2)
                await self.batch(sources.cluster_hotspots(rows), mem, jv, None)
            await asyncio.gather(*self.background)
        await self.summary()
        await self.emit("done", {})
