"""Deterministic rules: Jev answers + weather + FIRMS → verdicts, 1–5 scores and recommended actions.

Weights live here so they can be tuned live without re-running any model.
"""

DIRECTIONS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}
FUEL = {"conifer_forest": 1.0, "broadleaf_or_mixed_forest": 0.75, "grass_or_shrub": 0.8, "farmland": 0.35, "built_up_or_bare": 0.15}
DISTANCE = {"within_500m": 1.0, "500m_to_1500m": 0.7, "1500m_to_3500m": 0.4, "none_visible": 0.05}


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _to_scale(x: float) -> int:
    """0..1 → 1..5"""
    return int(round(1 + 4 * _clamp01(x)))


def classify(signals: dict[str, float]) -> tuple[str, float]:
    """Stage-1 verdict from Jev probabilities. Confidence = how far the deciding signal is from 0.5."""
    industrial, vegetation, water = signals["industrial_nearby"], signals["vegetation_nearby"], signals["center_is_open_water"]
    if industrial >= 0.5:
        return "industrial", abs(industrial - 0.5) * 2
    if vegetation >= 0.5:
        return "possible_fire", min(abs(vegetation - 0.5), abs(industrial - 0.5)) * 2
    if water >= 0.5:
        return "water", abs(water - 0.5) * 2
    return "other", abs(vegetation - 0.5) * 2


def is_downwind(wind_from_deg: float, settlement_direction: str) -> bool:
    """Wind direction is where it blows FROM; houses are downwind if they lie within 60° of where it blows TO."""
    if settlement_direction not in DIRECTIONS:
        return False
    blows_to = (wind_from_deg + 180) % 360
    diff = abs((DIRECTIONS[settlement_direction] - blows_to + 180) % 360 - 180)
    return diff <= 60


def score(probe: dict, weather: dict, hotspot: dict) -> dict:
    fuel = FUEL.get(probe["fuel_type"], 0.5)
    continuity = probe["vegetation_continuity"] / 3
    terrain = probe["terrain"] / 3
    frp = _clamp01(hotspot["frp"] / 15)
    growth = _clamp01((hotspot["detections"] - 1) / 20)

    gust = _clamp01((weather["wind_gust_ms"] - 3) / 17)
    dryness = 0.5 * _clamp01((70 - weather["humidity_pct"]) / 45) + 0.5 * _clamp01((15 - weather["rain_7d_mm"]) / 15)

    danger = 0.4 * fuel + 0.3 * frp + 0.3 * continuity
    spread = 0.4 * gust + 0.3 * dryness + 0.2 * continuity + 0.1 * terrain

    downwind = is_downwind(weather["wind_from_deg"], probe["settlement_direction"])
    exposure = DISTANCE.get(probe["settlement_distance"], 0.3) * (0.6 + 0.1 * probe["settlement_size"])
    exposure *= 1.3 if downwind else 0.8
    exposure *= 1 - 0.3 * probe["firebreak"]

    urgency = 0.35 * danger + 0.3 * spread + 0.25 * exposure + 0.25 * growth

    confidence = "high" if probe["cloud_cover"] < 2 or probe["smoke_plume"] > 0.6 else "medium"
    return {
        "danger": _to_scale(danger),
        "spread_risk": _to_scale(spread),
        "exposure": _to_scale(exposure),
        "urgency": _to_scale(urgency),
        "confidence": confidence,
        "downwind": downwind,
        "factors": {
            "fuel": round(fuel, 2), "vegetation_continuity": round(continuity, 2), "frp_norm": round(frp, 2),
            "gust_norm": round(gust, 2), "dryness": round(dryness, 2), "terrain": round(terrain, 2),
            "detection_growth": round(growth, 2),
        },
    }


def recommended_actions(scores: dict, probe: dict) -> list[str]:
    actions = []
    if scores["urgency"] >= 3:
        actions.append("Notify the municipal disaster-prevention office and local fire department")
    if scores["danger"] >= 4 and scores["exposure"] >= 3:
        actions.append(f"Prepare an evacuation advisory for the settlement to the {probe['settlement_direction']}")
    if scores["spread_risk"] >= 4:
        actions.append("Issue a fire-weather watch and monitor wind shifts")
    if probe.get("water_source", 0) >= 0.6:
        actions.append("Helicopter water source available near the site")
    if scores.get("confidence") == "low" or probe.get("smoke_plume", 1) < 0.3:
        actions.append("Request visual confirmation (patrol, drone or fixed camera)")
    return actions
