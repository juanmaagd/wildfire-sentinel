"""Fire propagation graph in Neo4j: every satellite detection of an incident, linked by how the fire spread.

(:Incident)-[:HAS_DAY]->(:FireDay)-[:NEXT]->(:FireDay)
(:Detection)-[:ON_DAY]->(:FireDay)
(:Detection)-[:SPREAD_TO {km, hours}]->(:Detection)   nearest detection of an earlier pass (≤ 2 km, ≤ 48 h)
(:Detection)-[:SEEN_AT]->(:Entity:Location)           the agent-memory site Jev judged (≤ 1 km)
"""

from datetime import date, datetime, timedelta, timezone

from neo4j import GraphDatabase

from . import sources
from .config import REPLAY_SOURCES, neo4j_config

SPREAD_KM = 2.0
SPREAD_WINDOW_H = 48
MIN_GAP_H = 1  # passes of different satellites minutes apart are the same moment, not spread
FIRST_SIGHTING_H = 3  # the satellites that first saw the fire (NOAA-20, NOAA-21, Suomi NPP pass within ~2 h)
SPAN = 0.2
DAYS = 9

BUILD = [
    "MATCH (i:Incident {id: $id}) OPTIONAL MATCH (i)-[:HAS_DAY]->(d:FireDay) OPTIONAL MATCH (x:Detection {incident: $id}) "
    "DETACH DELETE i, d, x",
    "CREATE (i:Incident {id: $id, name: $name, lat: $lat, lon: $lon, start: $start}) "
    "WITH i UNWIND $days AS day CREATE (i)-[:HAS_DAY]->(:FireDay {incident: $id, date: day.date, rain_mm: day.rain_mm})",
    "MATCH (a:FireDay {incident: $id}), (b:FireDay {incident: $id}) WHERE date(b.date) = date(a.date) + duration('P1D') "
    "CREATE (a)-[:NEXT]->(b)",
    "UNWIND $detections AS d MATCH (day:FireDay {incident: $id, date: d.date}) "
    "CREATE (x:Detection {incident: $id, id: d.id, lat: d.lat, lon: d.lon, frp: d.frp, satellite: d.satellite, "
    "at: datetime(d.at), hours_after: d.hours_after, loc: point({latitude: d.lat, longitude: d.lon})}) "
    "CREATE (x)-[:ON_DAY]->(day)",
    # Each detection descends from the nearest one seen on an earlier pass: the fire's own path.
    "MATCH (b:Detection {incident: $id}) "
    "CALL (b) { MATCH (a:Detection {incident: $id}) "
    "  WHERE a.at <= b.at - duration({hours: $gap}) AND a.at >= b.at - duration({hours: $window}) "
    "    AND point.distance(a.loc, b.loc) <= $km * 1000 "
    "  RETURN a ORDER BY point.distance(a.loc, b.loc) LIMIT 1 } "
    "CREATE (a)-[:SPREAD_TO {km: round(point.distance(a.loc, b.loc) / 1000.0, 2), "
    "hours: round(duration.inSeconds(a.at, b.at).seconds / 3600.0, 1)}]->(b)",
    "MATCH (x:Detection {incident: $id}), (s:Entity:Location {subtype: 'hotspot_site'}) "
    "WHERE point.distance(x.loc, point({latitude: s.location.y, longitude: s.location.x})) <= 1000 "
    "CREATE (x)-[:SEEN_AT]->(s)",
]

INSIGHTS = {
    "ignitions": "MATCH (x:Detection {incident: $id}) WHERE NOT ()-[:SPREAD_TO]->(x) "
                 "RETURN x.id AS id, toString(x.at) AS at, x.hours_after AS hours ORDER BY x.at",
    "longest_path": "MATCH p = (r:Detection {incident: $id})-[:SPREAD_TO*]->(x) WHERE NOT ()-[:SPREAD_TO]->(r) "
                    "WITH p, r, x ORDER BY length(p) DESC, x.at DESC LIMIT 1 "
                    "RETURN length(p) AS hops, [n IN nodes(p) | n.id] AS ids, r.hours_after AS from_h, x.hours_after AS to_h, "
                    "round(point.distance(r.loc, x.loc) / 1000.0, 1) AS km",
    "hubs": "MATCH (n:Detection {incident: $id})-[:SPREAD_TO*]->(m) "
            "WITH n, count(DISTINCT m) AS descendants ORDER BY descendants DESC LIMIT 3 "
            "RETURN n.id AS id, descendants, n.hours_after AS hours",
    "fastest": "MATCH (a:Detection {incident: $id})-[r:SPREAD_TO]->(b) WHERE r.hours >= 1 "
               "RETURN a.id AS from, b.id AS to, r.km AS km, r.hours AS hours, round(r.km / r.hours, 2) AS km_h "
               "ORDER BY km_h DESC LIMIT 1",
    "per_day": "MATCH (i:Incident {id: $id})-[:HAS_DAY]->(d:FireDay) OPTIONAL MATCH (x:Detection)-[:ON_DAY]->(d) "
               "OPTIONAL MATCH (x)<-[r:SPREAD_TO]-() "
               "RETURN d.date AS date, d.rain_mm AS rain_mm, count(DISTINCT x) AS detections, count(r) AS spread_links, "
               "round(coalesce(max(x.frp), 0), 1) AS max_frp ORDER BY d.date",
    "jev_sites": "MATCH (x:Detection {incident: $id})-[:SEEN_AT]->(s) "
                 "RETURN count(DISTINCT s) AS sites, count(x) AS detections",
}

GRAPH = {
    "nodes": "MATCH (x:Detection {incident: $id}) "
             "RETURN x.id AS id, 'Detection' AS kind, x.lat AS lat, x.lon AS lon, x.frp AS frp, x.satellite AS satellite, "
             "toString(x.at) AS at, x.hours_after AS hours "
             "UNION ALL MATCH (:Incident {id: $id})-[:HAS_DAY]->(d) "
             "RETURN 'day:' + d.date AS id, 'FireDay' AS kind, null AS lat, null AS lon, null AS frp, null AS satellite, "
             "d.date AS at, d.rain_mm AS hours "
             "UNION ALL MATCH (:Detection {incident: $id})-[:SEEN_AT]->(s) WITH DISTINCT s "
             "RETURN elementId(s) AS id, 'Site' AS kind, s.location.y AS lat, s.location.x AS lon, null AS frp, "
             "s.name AS satellite, null AS at, null AS hours",
    "rels": "MATCH (a:Detection {incident: $id})-[r:SPREAD_TO]->(b) "
            "RETURN a.id AS from, b.id AS to, 'SPREAD_TO' AS type, r.km AS km, r.hours AS hours "
            "UNION ALL MATCH (x:Detection {incident: $id})-[:ON_DAY]->(d) "
            "RETURN x.id AS from, 'day:' + d.date AS to, 'ON_DAY' AS type, null AS km, null AS hours "
            "UNION ALL MATCH (a:FireDay {incident: $id})-[:NEXT]->(b) "
            "RETURN 'day:' + a.date AS from, 'day:' + b.date AS to, 'NEXT' AS type, null AS km, null AS hours "
            "UNION ALL MATCH (x:Detection {incident: $id})-[:SEEN_AT]->(s) "
            "RETURN x.id AS from, elementId(s) AS to, 'SEEN_AT' AS type, null AS km, null AS hours",
}


def _detections(lat: float, lon: float, day: str) -> list[dict]:
    bbox = (lon - SPAN, lat - SPAN, lon + SPAN, lat + SPAN)
    second = (date.fromisoformat(day) + timedelta(days=5)).isoformat()
    rows = sources.fetch_hotspots_multi(bbox, 5, day, REPLAY_SOURCES) + sources.fetch_hotspots_multi(bbox, 4, second, REPLAY_SOURCES)
    out, seen = [], set()
    for r in rows:
        at = datetime.strptime(f"{r['acq_date']} {int(r['acq_time']):04d}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
        key = (r["latitude"], r["longitude"], r["acq_date"], r["acq_time"])
        if key in seen:
            continue
        seen.add(key)
        out.append({"lat": float(r["latitude"]), "lon": float(r["longitude"]), "frp": float(r["frp"]),
                    "satellite": r.get("satellite", ""), "when": at})
    if not out:
        return []
    t0 = min(d["when"] for d in out)
    jst = timezone(timedelta(hours=9))
    for i, d in enumerate(sorted(out, key=lambda d: d["when"])):
        d["id"] = f"det{i + 1}"
        d["at"] = d["when"].isoformat()
        d["date"] = d["when"].astimezone(jst).date().isoformat()
        d["hours_after"] = round((d["when"] - t0).total_seconds() / 3600, 1)
    return sorted(out, key=lambda d: d["when"])


def build(lat: float, lon: float, day: str, name: str) -> dict:
    """(Re)write the incident subgraph and return it with the graph insights. Idempotent per incident id."""
    incident = f"incident:{day}:{lat:.2f},{lon:.2f}"
    dets = _detections(lat, lon, day)
    for d in dets:
        d.pop("when")
    end = (date.fromisoformat(day) + timedelta(days=DAYS - 1)).isoformat()
    rain = sources.daily_rain(lat, lon, day, end)
    days = [{"date": d, "rain_mm": round(mm, 1)} for d, mm in sorted(rain.items())]
    cfg = neo4j_config()
    params = {"id": incident, "name": name, "lat": lat, "lon": lon, "start": day, "days": days, "detections": dets,
              "gap": MIN_GAP_H, "window": SPREAD_WINDOW_H, "km": SPREAD_KM}
    with GraphDatabase.driver(cfg["uri"], auth=(cfg["username"], cfg["password"])) as driver:
        for q in BUILD:
            driver.execute_query(q, params)
        insights = {k: [r.data() for r in driver.execute_query(q, params).records] for k, q in INSIGHTS.items()}
        nodes = [r.data() for r in driver.execute_query(GRAPH["nodes"], params).records]
        rels = [r.data() for r in driver.execute_query(GRAPH["rels"], params).records]
    roots = insights["ignitions"]
    insights["summary"] = {
        "detections": len(dets),
        "first_pass": sum(1 for r in roots if r["hours"] <= FIRST_SIGHTING_H),
        # A root after the first pass has no earlier detection within 2 km: a new front (spotting or a jump).
        "new_fronts": [r for r in roots if r["hours"] > FIRST_SIGHTING_H],
        "spread_links": sum(1 for r in rels if r["type"] == "SPREAD_TO"),
    }
    return {"incident": incident, "name": name, "nodes": nodes, "rels": rels, "insights": insights,
            "cypher": {"spread": BUILD[4], **INSIGHTS}}
