import pytest

from sentinel.scoring import classify, is_downwind, recommended_actions, score

CALM_DRY = {"wind_speed_ms": 2.0, "wind_gust_ms": 4.0, "wind_from_deg": 270, "humidity_pct": 60, "rain_7d_mm": 20.0}
STORM_DRY = {"wind_speed_ms": 9.0, "wind_gust_ms": 24.0, "wind_from_deg": 270, "humidity_pct": 30, "rain_7d_mm": 0.5}


def probe(**overrides) -> dict:
    base = {
        "fuel_type": "conifer_forest", "vegetation_continuity": 3.0, "settlement_distance": "within_500m",
        "settlement_direction": "E", "settlement_size": 2.0, "terrain": 2.0, "firebreak": 0.1,
        "water_source": 0.9, "smoke_plume": 0.2, "cloud_cover": 1.0,
    }
    return {**base, **overrides}


HOTSPOT = {"frp": 12.0, "detections": 3}


@pytest.mark.parametrize(
    ("signals", "expected"),
    [
        ({"industrial_nearby": 0.9, "vegetation_nearby": 0.9, "houses_nearby": 0.5, "center_is_open_water": 0.1}, "industrial"),
        ({"industrial_nearby": 0.1, "vegetation_nearby": 0.9, "houses_nearby": 0.5, "center_is_open_water": 0.1}, "possible_fire"),
        ({"industrial_nearby": 0.1, "vegetation_nearby": 0.2, "houses_nearby": 0.5, "center_is_open_water": 0.9}, "water"),
        ({"industrial_nearby": 0.1, "vegetation_nearby": 0.2, "houses_nearby": 0.9, "center_is_open_water": 0.1}, "other"),
    ],
    ids=["industry wins over vegetation", "vegetation without industry alerts", "open water", "built-up, no vegetation"],
)
def test_classify_turns_sentinel_signals_into_a_verdict(signals, expected):
    verdict, _ = classify(signals)
    assert verdict == expected


def test_classify_confidence_is_low_when_the_deciding_signal_is_near_half():
    _, confident = classify({"industrial_nearby": 0.05, "vegetation_nearby": 0.95, "houses_nearby": 0.5, "center_is_open_water": 0.0})
    _, unsure = classify({"industrial_nearby": 0.45, "vegetation_nearby": 0.55, "houses_nearby": 0.5, "center_is_open_water": 0.0})
    assert confident > unsure


@pytest.mark.parametrize(
    ("wind_from_deg", "settlement_direction", "expected"),
    [(270, "E", True), (270, "W", False), (0, "S", True), (0, "N", False), (270, "none", False)],
    ids=["west wind blows to east houses", "west wind away from west houses", "north wind to south", "north wind away from north", "no houses"],
)
def test_is_downwind_when_wind_blows_from_fire_toward_houses(wind_from_deg, settlement_direction, expected):
    assert is_downwind(wind_from_deg, settlement_direction) is expected


def test_exposure_is_higher_when_houses_are_downwind():
    toward = score(probe(settlement_direction="E"), STORM_DRY, HOTSPOT)
    away = score(probe(settlement_direction="W"), STORM_DRY, HOTSPOT)
    assert toward["exposure"] > away["exposure"]


def test_dense_forest_with_strong_fire_is_more_dangerous_than_isolated_farmland():
    forest = score(probe(fuel_type="conifer_forest", vegetation_continuity=3.0), STORM_DRY, {"frp": 15.0, "detections": 3})
    farm = score(probe(fuel_type="farmland", vegetation_continuity=0.0), STORM_DRY, {"frp": 1.0, "detections": 1})
    assert forest["danger"] > farm["danger"]


def test_spread_risk_is_higher_in_dry_gusty_weather_than_calm_wet_weather():
    assert score(probe(), STORM_DRY, HOTSPOT)["spread_risk"] > score(probe(), CALM_DRY, HOTSPOT)["spread_risk"]


def test_urgency_rises_as_detections_accumulate():
    first = score(probe(), STORM_DRY, {"frp": 5.0, "detections": 1})
    growing = score(probe(), STORM_DRY, {"frp": 5.0, "detections": 30})
    assert growing["urgency"] > first["urgency"]


def test_all_scores_stay_on_the_1_to_5_scale():
    extremes = [score(probe(), STORM_DRY, {"frp": 500.0, "detections": 500}),
                score(probe(fuel_type="built_up_or_bare", vegetation_continuity=0.0, settlement_distance="none_visible",
                            settlement_direction="none", settlement_size=0.0, terrain=0.0), CALM_DRY, {"frp": 0.1, "detections": 1})]
    assert [{k: 1 <= s[k] <= 5 for k in ("danger", "spread_risk", "exposure", "urgency")} for s in extremes] == [
        {"danger": True, "spread_risk": True, "exposure": True, "urgency": True}] * 2


EVACUATION = "Prepare an evacuation advisory for the settlement to the E"


@pytest.mark.parametrize(
    ("danger", "exposure", "expected"),
    [(4, 3, True), (5, 5, True), (3, 5, False), (5, 2, False)],
    ids=["danger 4 exposure 3", "danger 5 exposure 5", "danger too low", "exposure too low"],
)
def test_evacuation_advice_only_when_danger_and_exposure_are_high(danger, exposure, expected):
    scores = {"danger": danger, "spread_risk": 3, "exposure": exposure, "urgency": 4, "confidence": "high"}
    actions = recommended_actions(scores, probe(settlement_direction="E"))
    assert (EVACUATION in actions) is expected


def test_low_confidence_asks_for_visual_confirmation():
    scores = {"danger": 3, "spread_risk": 3, "exposure": 2, "urgency": 3, "confidence": "low"}
    assert "Request visual confirmation (patrol, drone or fixed camera)" in recommended_actions(scores, probe())
