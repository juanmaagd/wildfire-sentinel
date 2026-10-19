# Worldwide coverage
Objective: make Wildfire Sentinel work outside Japan before deploying. Branch `feat/wildfire-sentinel`, delivery ask-on-risk, runner `cd app && uv run pytest` + spike scripts.

## Specs
- S1 — "no solo limitarlo a japon sino worldwide a ser posible": aerial imagery for Jev everywhere. Decision (user, "dale hazlo"): GSI in Japan, Esri World Imagery elsewhere, validated first by comparing Jev verdicts on both providers.
- S2 — Map basemaps (hotspot map, 3D spread view) show imagery outside Japan.
- S3 — Live mode beyond the Japan bbox (scope pending user decision: region selector vs other).
- S4 — Times and report language per region (pending).

## Tasks
- T1 S1 inline — provider-agnostic `aerial_mosaic` (auto = GSI then Esri), `ESRI_API_KEY` optional; spike `spike/provider_compare.py`. Done.
- T2 S2 inline — `/api/tiles/imagery` proxy (key stays server-side), Esri layer under GSI in both maps. Done.
- T3 S3 — pending decision.
- T4 S4 — pending.

## Log
- L1 (2026-10-18) "Ahora tenemos que desplegarlo, pero antes me gustaria a no solo limitarlo a japon sino worldwide a ser posible"
- L2 (2026-10-20) "funcionaria bien con gsi tambien?" → "dale hazlo" (GSI + Esri, test first).
- L3 Spike: Jev stage-1 verdict GSI vs Esri on 23 Japanese sites (industrial, water, other, possible_fire): 23/23 identical. Esri abroad: 8/8 expected (4 steelworks/refineries, 4 forests in CA, PT, GR, US).
- L4 Without ESRI_API_KEY the public Esri endpoint is used: fine for development, production needs an ArcGIS Location Platform key (free tier, attribution required). Weather and timeline times are still JST everywhere (S4).
