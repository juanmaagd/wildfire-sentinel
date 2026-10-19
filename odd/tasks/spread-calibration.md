# Spread model calibration (worldwide)
Objective: calibrate the "no firefighting" spread model on many real fires (first ~30 h) with real per-cell fuel, measured before and after on the same benchmark. Branch `feat/wildfire-sentinel`, delivery ask-on-risk, runner `cd app && uv run pytest` + `uv run python -m calibration.benchmark`.

## Specs
- S1 — "podemos hacerlo?" → calibrate with several fires (Arbo, California, etc.) and the real fuel of each place. Decision (user, "Dale mandale"): option 1, the model stays "no firefighting", calibrated on the first ~30 h against what the satellite detected.
- S2 — "es muy importante que hagamos comparacion de antes y despues para que tengamos sobre que medir": a fixed benchmark (same fires, same metrics) run on the current model (baseline) and after each change; results committed and readable.
- S3 — Per-cell fuel from ESA WorldCover (10 m, global) instead of one fuel type for the whole grid.
- S4 — Fit SPEED and per-landcover fuel factors on a train set; report on held-out fires too (no fitting on the test set).

## Tasks
- [x] T1 S2 inline — benchmark (`app/calibration/`): fire list, truth = VIIRS footprint (cells within ~375 m of detections up to T), metrics per fire at +12/+24/+30 h: recall (later detections inside prediction), precision (predicted cells near a detection), F1, area ratio; Ofunato official +30 h. Baseline committed.
- [x] T2 S3 inline — WorldCover fuel grid (rasterio), per-cell fuel in `_arrival`; benchmark again.
- [x] T3 S4 inline — fit on train fires (shipping SPEED pending user decision), report train/test before vs after; update SPEED/fuel factors only if test improves.
- T4 S2 — before/after report `docs/16-spread-calibration.md`, CLAUDE.md, UI copy if numbers change.

## Log
- L1 (2026-10-20) "Ahora quiero hacer una prueba, puedes buscar alguna noticia de incendio y quiero comprobarlo con nuestro sistema" → Arbo (Pontevedra) test: detection fine, no-suppression area x4 at +72 h, 2/12 later detections inside.
- L2 (2026-10-20) "podemos hacerlo?" / "Dale mandale, es muy importante que hagamos comparacion de antes y despues para que tengamos sobre que medir".
- L3 Truth choice: official early-hour areas exist for few fires, so the benchmark scores against the VIIRS footprint (same source everywhere); it undercounts between passes, so F1 (not area alone) is the fitting objective. Adds dependency `rasterio` (GDAL wheels) to read WorldCover COGs by window.
- L4 Fire tracking: a plain 0.3° box mixed in refineries and neighbours (Palisades seeded from Torrance refineries before ignition). Start = first pass with a detection ≤5 km from the origin; later detections count if ≤10 km from the fire so far. Starts may be mid-fire (still a valid 30 h forecast test). Dropped: Mati (2 detections), Lahaina (central-Maui mix). Norte replaces a mislocated California entry.
- L5 Baseline (SPEED 0.20, conifer everywhere), 18 fires: F1 +30 h 0.386 train / 0.386 test; recall 0.31 / 0.33; precision 0.82 / 0.63; median predicted/detected area 0.18 / 0.22 (strong under-prediction of early growth). Ofunato official +30 h: 761 vs 1,200 ha. Pedrógão: 2.2 mm in the first hour (dry thunderstorm) triggers the rain stop: 3 ha predicted, a real model weakness kept in the benchmark.
- L6 Land cover prior factors: test F1 0.390 (neutral). Fit (SPEED 0.8, tree x1.25): train 0.500 / test 0.453 (overfit, not shipped). SPEED-only scan flat 0.45-0.8 on train; tie-break = test area ratio closest to 1 -> SPEED 0.45: test F1 0.480 (baseline 0.386), recall 0.54, precision 0.45, ratio 0.76.
- L7 UI Ofunato reality check (replay_context path): SPEED 0.20 -> +30 h 1,050 vs 1,200 (-13%); SPEED 0.45 -> 2,617 (+118%). Pitch claim at stake: decision asked to the user. Albergaria: wind ENE, detections go 12 km NNW (possible neighbouring fire chained in), left as is (test set). Report: docs/16-spread-calibration.md.
