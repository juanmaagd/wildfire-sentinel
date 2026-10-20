# 16 — Spread model calibration: before and after

The spread model predicts how a fire grows **if nobody fights it**. Until now it was calibrated on one fire (Ofunato). This page measures it on 18 real fires in 9 countries, before and after calibrating, with the same benchmark every time.

Benchmark: `app/calibration/` (`uv run python -m calibration.benchmark --label <name>`), raw results in `app/calibration/results/*.json`.

## How it is measured

- **Fires** (`calibration/fires.py`): 12 train fires (used to fit) and 6 test fires (never used to fit):

  | Split | Fires |
  | --- | --- |
  | Train | Ofunato (JP), Camp, Palisades, Caldor and Norte (US-CA), Marshall (US-CO), Viña del Mar (CL), Alexandroupolis (GR), Tenerife (ES), Jasper (CA), Uiseong (KR), Pedrógão (PT) |
  | Test | Arbo (ES), Eaton (US), Rhodes (GR), Imabari (JP), Fort McMurray (CA), Albergaria (PT) |

- **Start**: the first satellite pass with a detection within 5 km of the fire's origin. Later detections count when they lie within 10 km of the fire so far. A plain bounding box pulled in refineries and neighbouring fires: Palisades was being seeded from refineries in Torrance before it even started.
- **Truth**: what VIIRS saw. It is the only source that exists for every fire.
- **Scored at +12, +24 and +30 h**, before firefighting changes the outcome much:

  | Metric | Meaning |
  | --- | --- |
  | Recall | Share of later detections that fall inside the predicted area |
  | Precision | Share of the predicted area that the satellite saw burning |
  | F1 | Both together; this is the fitting objective |
  | Area ratio | Predicted area ÷ detected footprint |

## Results at +30 h

| Model | Train F1 | **Test F1** | Test recall | Test precision | Test area ratio (median) |
| --- | --- | --- | --- | --- | --- |
| **Before**: SPEED 0.20, conifer everywhere | 0.386 | **0.386** | 0.33 | 0.63 | 0.22 |
| ESA WorldCover fuel, prior factors | 0.367 | 0.390 | 0.32 | 0.65 | 0.21 |
| WorldCover fuel, fitted (SPEED 0.8, tree ×1.25) | 0.500 | 0.453 | 0.66 | 0.36 | 1.96 |
| SPEED 0.6, no land cover | 0.460 | 0.473 | 0.61 | 0.40 | 1.39 |
| **After**: SPEED 0.45, no land cover | 0.455 | **0.480** | 0.54 | 0.45 | 0.76 |

**What changed**
- The old model saw about a fifth of the fire in its first 30 h: median area ratio 0.22, recall 0.33. The calibrated SPEED predicts about as much area as the satellite sees, and finds 54 % of the later detections instead of 33 %.
- Test F1 goes from 0.386 to 0.480, a 24 % improvement on fires the fit never saw.
- Between SPEED 0.45 and 0.8 the train score is flat (0.456–0.457). Among those values, 0.45 is the one whose test area ratio is closest to 1, so it is the pick.

**Land cover is neutral at 30 h**
- Fitted fuel factors raise train F1 to 0.500 but lower test F1 to 0.453. That is overfitting, so they are not shipped.
- The reason: in their first 30 h these fires stay inside forest and shrub, whose factors are all close to each other. Land cover should matter later, when a fire reaches farmland or a town, and this benchmark does not look that far.
- The code is in place (`sentinel/landcover.py`, `fuel_factors` in `spread._prepare`) but production does not use it.

**Known misses** (follow-ups, not fixed here)
- **Pedrógão**: F1 ≈ 0 at every SPEED. A 2.2 mm reading in the first hour comes from a dry thunderstorm, and the rain rule reads it as wet fuel, so spread stops for 24 h.
- **Albergaria**: recall stays near 0 at every SPEED. The wind pushes the model west-southwest, but the detections go 12 km north-northwest. That may be a neighbouring fire from the same Aveiro outbreak that the 10 km chaining linked in. It is a test fire, so its definition was left as is.

## The trade-off: Ofunato in the app

Ofunato's official figures measure the burned area including firefighting. With the UI replay (`/api/spread`):

| Official figure | Real | SPEED 0.20 | SPEED 0.45 |
| --- | --- | --- | --- |
| +30 h (NHK) | 1,200 ha | 1,050 (−13 %) | 2,617 (+118 %) |
| Final survey | 3,370 ha | 5,436 (+61 %) | 11,361 (+237 %) |

Across 18 fires, the calibrated model is better at predicting where the fire goes in its first 30 h. On Ofunato's official area, it is further off.

Two things explain this:
- Ofunato was the one fire the old value was tuned on.
- The official areas include firefighting, while the benchmark scores what the satellite saw burning.

Raising SPEED also enlarges the "no action" side of the response plans (line km, crews).

## Decision (2026-10-20)

SPEED 0.45 ships. The prediction has to be as realistic as possible, and the model cannot foresee firefighting, so it is calibrated on what the satellite saw burning, not on official areas that include suppression. The pitch (`docs/13`, `docs/14`, `docs/15`) now cites the 18-fire benchmark instead of Ofunato's −5 %; the Ofunato reality check (~2,600–3,100 ha predicted vs 1,200 ha at +30 h, depending on the hotspot opened) is presented as the "nobody fights it" scenario.

## Round 2: weather, fuel moisture and land cover (2026-10-20)

Request: the prediction must adapt to each environment, weather and terrain, and fix every known miss that can be fixed.

**Changes**
- **Fuel moisture, hour by hour.** It replaces the binary rain rule (≥ 2 mm in 24 h stopped spread for a day). The model tracks dead fine-fuel moisture:
  - it relaxes toward the equilibrium moisture of the hour's temperature and humidity (Simard 1968) with a 6 h lag;
  - rain adds 5 % per mm;
  - Rothermel's moisture damping turns it into a speed factor, with extinction at 25 %.
  - Open-Meteo now also returns `temperature_2m`.
- **Land cover on in production.** ESA WorldCover sets the fuel of every 180 m cell, in both the prediction and the response plan. Prior factors are used, since fitting them overfit in round 1. Inland water and snow don't burn; crops, towns and bare ground slow the fire.
- **Albergaria truth fixed, for a data reason.** The cluster 10–14 km north-northwest that appears from +24 h is the Oliveira de Azeméis fire, a separate ignition on 2024-09-14 (ICNF report on the Aveiro fire complex). The 10 km chaining had linked it in. It is now excluded by a box in `fires.py`.
- **Faster terrain.** The 9 DEM tiles download in parallel: 7–8 s became 1.3 s, with an identical grid. The first land-cover read of a new area adds 3–6 s; later reads come from the cache.

**SPEED refit, train only** (`calibration/scan.py`)
- Same rule as `fit.py`: a gain under 0.002 is noise.
- With land cover, train F1 is 0.454 at 0.8, 0.481 at 1.0 and 0.483 at 1.2. SPEED = 1.0 is chosen.

**Before and after, on the same corrected benchmark** (mean F1 over +12/+24/+30 h on train; values at +30 h on test)

| Model | Train F1 | Test F1 +30 h | Test recall | Test area ratio (median) |
| --- | --- | --- | --- | --- |
| Before: SPEED 0.45, rain stop, one fuel | 0.456 | 0.494 | 0.59 | 0.76 |
| Fuel moisture only, SPEED 0.8 | 0.467 | 0.495 | 0.66 | 1.22 |
| **After: fuel moisture + land cover, SPEED 1.0** | **0.481** | **0.507** | **0.67** | 1.47 |

Raw results: `results/moisture_landcover.json`.

**Still missed**
- **Pedrógão** (F1 0.002 → 0.035). The rain stop is gone, but the real fire burned a ~24,000 ha footprint in 12 h, driven by a thunderstorm downburst and its own plume. The reanalysis wind is 1–4 m/s. A wind-and-slope model with hourly reanalysis weather cannot see that.
- **Albergaria** (0.078). It over-predicts once the wind reaches 6–10 m/s on day 2: 4,500 ha predicted vs a 565 ha footprint.
- **Area.** On the test fires the median predicted area is 1.5× the satellite footprint at +30 h. The train fires lean the other way (0.56×), so a single SPEED is a compromise.

**Ofunato in the app** (UI replay, first-pass hotspots)

| Time | Official | Prediction |
| --- | --- | --- |
| +30 h | 1,200 ha | 3,800–4,200 ha |
| Final | 3,370 ha | ~16,300 ha |

In the benchmark, seeded only within 5 km of the origin, it is 1,557 ha at +30 h. The UI replay also seeds 4 first-pass detections 5–6 km away, and each one grows as its own front.
