"""Neo4j Agent Memory: sites as LOCATION entities, every verdict as a reasoning trace with a tool call."""

import asyncio

from neo4j_agent_memory import MemoryClient, MemorySettings

from .config import neo4j_config

SESSION = "wildfire-sentinel"
RADIUS_KM = 1.0
# Concurrent entity writes deadlock in Neo4j (dedup locks); writes are serialized, alerts are emitted before them.
_write_lock = asyncio.Lock()


def client() -> MemoryClient:
    return MemoryClient(MemorySettings(
        neo4j=neo4j_config(),
        embedding={"provider": "sentence_transformers", "model": "all-MiniLM-L6-v2", "dimensions": 384},
    ))


async def lookup(memory: MemoryClient, lat: float, lon: float) -> dict | None:
    found = await memory.long_term.search_locations_near(lat, lon, radius_km=RADIUS_KM, limit=1)
    if not found:
        return None
    site = found[0]
    return {"name": site.name, **(site.attributes or {})}


async def remember_triage(memory: MemoryClient, hotspot, verdict: str, confidence: float, signals: dict, ms: int) -> str:
    async with _write_lock:
        return await _remember_triage(memory, hotspot, verdict, confidence, signals, ms)


async def _remember_triage(memory: MemoryClient, hotspot, verdict: str, confidence: float, signals: dict, ms: int) -> str:
    name = f"Site {hotspot.lat:.3f},{hotspot.lon:.3f}"
    trace = await memory.reasoning.start_trace(SESSION, f"Triage hotspot {hotspot.id} (frp {hotspot.frp} MW)",
                                                metadata={"acq_date": hotspot.acq_date})
    step = await memory.reasoning.add_step(trace.id, thought="New location: judge the GSI aerial photo", action="jev.sentinel")
    await memory.reasoning.record_tool_call(step.id, "jev.sentinel", {"lat": hotspot.lat, "lon": hotspot.lon},
                                            result={"verdict": verdict, **signals}, duration_ms=ms)
    await memory.long_term.add_entity(
        name, "LOCATION", subtype="hotspot_site", coordinates=(hotspot.lat, hotspot.lon),
        attributes={"verdict": verdict, "confidence": round(confidence, 2), "first_seen": hotspot.acq_date,
                    "image": f"{hotspot.lat:.4f}_{hotspot.lon:.4f}_z16.jpg"},
        description=f"FIRMS hotspot site judged {verdict}", geocode=False, enrich=False,
    )
    await memory.reasoning.complete_trace(trace.id, outcome=f"{verdict} ({confidence:.2f})", success=True)
    return name


async def remember_report(memory: MemoryClient, hotspot, scores: dict, model: str, ms: int) -> None:
    async with _write_lock:
        await _remember_report(memory, hotspot, scores, model, ms)


async def _remember_report(memory: MemoryClient, hotspot, scores: dict, model: str, ms: int) -> None:
    trace = await memory.reasoning.start_trace(SESSION, f"Situation report for {hotspot.id}", metadata={"acq_date": hotspot.acq_date})
    step = await memory.reasoning.add_step(trace.id, thought="Possible fire: deep probe + analyst report", action="aiand.report")
    await memory.reasoning.record_tool_call(step.id, "aiand.report", {"hotspot": hotspot.id, "model": model},
                                            result={k: scores[k] for k in ("danger", "spread_risk", "exposure", "urgency")}, duration_ms=ms)
    await memory.reasoning.complete_trace(trace.id, outcome=f"urgency {scores['urgency']}/5", success=True)


def forget_area(bbox: tuple[float, float, float, float]) -> int:
    """Replay starts fresh: forget hotspot sites inside the replay area only (live-mode sites are kept)."""
    from neo4j import GraphDatabase

    west, south, east, north = bbox
    cfg = neo4j_config()
    with GraphDatabase.driver(cfg["uri"], auth=(cfg["username"], cfg["password"])) as driver:
        records, _, _ = driver.execute_query(
            "MATCH (e:Entity:Location {subtype: 'hotspot_site'}) "
            "WHERE e.location.x >= $west AND e.location.x <= $east AND e.location.y >= $south AND e.location.y <= $north "
            "DETACH DELETE e RETURN count(*) AS n",
            west=west, east=east, south=south, north=north,
        )
    return records[0]["n"]


async def history(memory: MemoryClient, lat: float, lon: float) -> list[dict]:
    """Past sites near a fire (for the analyst): what memory already knows about the area."""
    near = await memory.long_term.search_locations_near(lat, lon, radius_km=5.0, limit=20)
    return [{"name": s.name, **(s.attributes or {})} for s in near]
