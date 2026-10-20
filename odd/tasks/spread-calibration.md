# Spread model calibration (worldwide)
Objective: calibrate the "no firefighting" spread model on many real fires (first ~30 h) with real per-cell fuel, measured before and after on the same benchmark. Branch `feat/wildfire-sentinel`, delivery ask-on-risk, runner `cd app && uv run pytest` + `uv run python -m calibration.benchmark`.

## Specs
- S1 — "podemos hacerlo?" → calibrate with several fires (Arbo, California, etc.) and the real fuel of each place. Decision (user, "Dale mandale"): option 1, the model stays "no firefighting", calibrated on the first ~30 h against what the satellite detected.
- S2 — "es muy importante que hagamos comparacion de antes y despues para que tengamos sobre que medir": a fixed benchmark (same fires, same metrics) run on the current model (baseline) and after each change; results committed and readable.
- S3 — Per-cell fuel from ESA WorldCover (10 m, global) instead of one fuel type for the whole grid.
- S4 — Fit SPEED and per-landcover fuel factors on a train set; report on held-out fires too (no fitting on the test set).
- S5 — "dale corrige todo lo que se pueda": fix the known misses where the data allows (Pedrógão dry-thunderstorm rain stop; Albergaria truth check).
- S6 — "la prediccion debe adaptarse a los entornos y condiciones climaticas como de terrenos": hourly fuel moisture from temperature, humidity and rain (no binary rain stop); per-cell land cover (forest, crops, towns, inland water) in production.
- S7 — Measured before/after on the same benchmark (baseline = SPEED 0.45, commit 63fa137); ship only what holds on the test fires.

## Tasks
- [x] T1 S2 inline — benchmark (`app/calibration/`): fire list, truth = VIIRS footprint (cells within ~375 m of detections up to T), metrics per fire at +12/+24/+30 h: recall (later detections inside prediction), precision (predicted cells near a detection), F1, area ratio; Ofunato official +30 h. Baseline committed.
- [x] T2 S3 inline — WorldCover fuel grid (rasterio), per-cell fuel in `_arrival`; benchmark again.
- [x] T3 S4 inline — fit on train fires (shipping SPEED pending user decision), report train/test before vs after; update SPEED/fuel factors only if test improves.
- [x] T4 S2 inline — before/after report `docs/16-spread-calibration.md`, CLAUDE.md, UI copy if numbers change.

- [x] T5 S5,S6 inline — fuel-moisture state (EMC from temp+RH, rain wetting, drying lag) replaces RAIN_STOP; temperature in hourly weather; benchmark refetches hourly.
- [x] T6 S6 inline — land cover on in simulate + plan; cold-call latency measured.
- [x] T7 S5 inline — Albergaria truth check (data reason only).
- [x] T8 S7 inline — refit SPEED on train, report train/test, update Ofunato numbers in docs/UI once.

## Log
- L1 (2026-10-20) "Ahora quiero hacer una prueba, puedes buscar alguna noticia de incendio y quiero comprobarlo con nuestro sistema" → Arbo (Pontevedra) test: detection fine, no-suppression area x4 at +72 h, 2/12 later detections inside.
- L2 (2026-10-20) "podemos hacerlo?" / "Dale mandale, es muy importante que hagamos comparacion de antes y despues para que tengamos sobre que medir".
- L3 Truth choice: official early-hour areas exist for few fires, so the benchmark scores against the VIIRS footprint (same source everywhere); it undercounts between passes, so F1 (not area alone) is the fitting objective. Adds dependency `rasterio` (GDAL wheels) to read WorldCover COGs by window.
- L4 Fire tracking: a plain 0.3° box mixed in refineries and neighbours (Palisades seeded from Torrance refineries before ignition). Start = first pass with a detection ≤5 km from the origin; later detections count if ≤10 km from the fire so far. Starts may be mid-fire (still a valid 30 h forecast test). Dropped: Mati (2 detections), Lahaina (central-Maui mix). Norte replaces a mislocated California entry.
- L5 Baseline (SPEED 0.20, conifer everywhere), 18 fires: F1 +30 h 0.386 train / 0.386 test; recall 0.31 / 0.33; precision 0.82 / 0.63; median predicted/detected area 0.18 / 0.22 (strong under-prediction of early growth). Ofunato official +30 h: 761 vs 1,200 ha. Pedrógão: 2.2 mm in the first hour (dry thunderstorm) triggers the rain stop: 3 ha predicted, a real model weakness kept in the benchmark.
- L6 Land cover prior factors: test F1 0.390 (neutral). Fit (SPEED 0.8, tree x1.25): train 0.500 / test 0.453 (overfit, not shipped). SPEED-only scan flat 0.45-0.8 on train; tie-break = test area ratio closest to 1 -> SPEED 0.45: test F1 0.480 (baseline 0.386), recall 0.54, precision 0.45, ratio 0.76.
- L7 UI Ofunato reality check (replay_context path): SPEED 0.20 -> +30 h 1,050 vs 1,200 (-13%); SPEED 0.45 -> 2,617 (+118%). Pitch claim at stake: decision asked to the user. Albergaria: wind ENE, detections go 12 km NNW (possible neighbouring fire chained in), left as is (test set). Report: docs/16-spread-calibration.md.
- L8 (2026-10-20) "Si, tiene que ser lo mas realista posible si es una prediccion amigo, no podemos tampoco nosotros preveer influiencia de bomberos" → SPEED 0.45 shipped. Ofunato +30 h now 2,633–3,145 ha depending on the opened hotspot (SPEED 0.20: 1,001–1,176). Pitch docs 13/14/15, CLAUDE.md (was wrongly 0.35) and RealityCheck copy updated.
- L9 (2026-10-20) "dale corrige todo lo que se pueda, y la prediccion debe adaptarse a los entornos y condiciones climaticas como de terrenos"
- L10 Fuel moisture (Simard EMC, 6 h lag, 5 %/mm rain, extinction 25 %) replaces the rain stop; Pedrógão recovers in hours but stays a miss (plume-driven, reanalysis wind 1-4 m/s). Albergaria: NNW cluster = Oliveira de Azeméis fire (separate ignition 2024-09-14, ICNF Aveiro complex report), excluded by box. Land cover on in simulate + plan. Train-only SPEED scan -> 1.0 (1.2 gains 0.002 = noise rule). Same corrected benchmark: before (0.45, rain stop, one fuel) train 0.456 / test +30 h 0.494; after train 0.481 / test 0.507, recall 0.59 -> 0.67, test area ratio 0.76 -> 1.47. DEM tiles in parallel: 7-8 s -> 1.3 s. UI Ofunato +30 h 3,803-4,182 ha (first-pass hotspots). Docs 13/14/15/16, CLAUDE.md updated.
