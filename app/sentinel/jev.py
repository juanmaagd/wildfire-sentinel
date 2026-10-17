"""Jev stage 1 (sentinel) and stage 2 (deep probe)."""

import time

from typesafe_sdk import AsyncTypeSafeClient, Image, RetryPolicy

from .questions import PROBE, SENTINEL

HEADERS = {"TypeSafe-Danger-Zone-Images": "true"}


def client() -> AsyncTypeSafeClient:
    return AsyncTypeSafeClient(model="jev-preview", timeout=30.0,
                               retry=RetryPolicy(max_retries=5, backoff_initial=1.0, backoff_max=20.0))


async def sentinel(jev: AsyncTypeSafeClient, close_path) -> tuple[dict, int]:
    started = time.perf_counter()
    r = await jev.system_one(state={"close": Image(close_path)}, questions=SENTINEL, extra_headers=HEADERS)
    return {k: round(v.noul, 3) for k, v in r.nouls.items()}, int((time.perf_counter() - started) * 1000)


async def probe(jev: AsyncTypeSafeClient, close_path, wide_path, satellite_path) -> tuple[dict, dict, int]:
    """Returns (flat answers for scoring, detailed answers for the UI, latency_ms)."""
    state = {"close": Image(close_path), "wide": Image(wide_path)}
    questions = dict(PROBE)
    if satellite_path is None:
        questions.pop("smoke_plume")
        questions.pop("cloud_cover")
    else:
        state["satellite"] = Image(satellite_path)
    started = time.perf_counter()
    r = await jev.system_one(state=state, questions=questions, extra_headers=HEADERS)
    ms = int((time.perf_counter() - started) * 1000)

    flat, detail = {}, {}
    for k, a in r.choices.items():
        flat[k] = a.choice
        detail[k] = {"value": a.choice, "confidence": round(a.confidence, 2), "probabilities": {o: round(p, 2) for o, p in a.probabilities.items()}}
    for k, a in r.scores.items():
        flat[k] = a.score
        detail[k] = {"value": round(a.score, 2), "confidence": round(a.confidence, 2), "label": a.legend[round(a.score)]}
    for k, a in r.nouls.items():
        flat[k] = a.noul
        detail[k] = {"value": round(a.noul, 2), "probability": round(a.noul, 2)}
    flat.setdefault("smoke_plume", 0.0)
    flat.setdefault("cloud_cover", 3.0)
    return flat, detail, ms
