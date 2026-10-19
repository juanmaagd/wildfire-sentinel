# Worldwide coverage
Objective: make Wildfire Sentinel work outside Japan before deploying. Branch `feat/wildfire-sentinel`, delivery ask-on-risk, runner `cd app && uv run pytest` + spike scripts.

## Specs
- S1 — "no solo limitarlo a japon sino worldwide a ser posible": aerial imagery for Jev everywhere. Decision (user, "dale hazlo"): GSI in Japan, Esri World Imagery elsewhere, validated first by comparing Jev verdicts on both providers.
- S2 — Map basemaps (hotspot map, 3D spread view) show imagery outside Japan.
- S3 — Live mode beyond the Japan bbox. Decision (user, "2"): live analyses the current map view, capped to the strongest hotspots.
- S5 — "no haga nuevas peticiones al mover, debe darle a un boton para volver a analizar sobre una zona como lo hace maps"; "La vista por defecto es tu ubicación debemos pedir permisos y tal, sino la vista dafault EEUU"; "botom de mi ubicacion".
- S4 — "las fechas ... deben enseñarse con el formato y depende donde está el usuario" (viewer's locale and time zone). Report language per region: pending.
- S6 — "solo japon lo veo bien definido en el mapa como que los demas paises no me cargan": detailed basemap worldwide.

## Tasks
- T1 S1 inline — provider-agnostic `aerial_mosaic` (auto = GSI then Esri), `ESRI_API_KEY` optional; spike `spike/provider_compare.py`. Done.
- T2 S2 inline — `/api/tiles/imagery` proxy (key stays server-side), Esri layer under GSI in both maps. Done.
- T3 S3 inline — `/api/run?mode=live&bbox=w,s,e,n` (validated before the stream), `LIVE_MAX = 150` by FRP, `skipped_weak` in summary; Live button sends the map view. Done.
- T4 S4 inline — Intl formatters in the browser's locale/zone; naive JST forecast times pinned to +09:00. Done (ai& report text still quotes JST).
- T6 S6 inline — 2D basemap → OpenFreeMap dark (OSM vector, local labels). Done.
- T5 S5 inline — "Search this area" on the map (only after a move, hidden while running; Live left the header), geolocation on load (zoom 8) with USA fallback, "My location" button. Done.

## Log
- L1 (2026-10-18) "Ahora tenemos que desplegarlo, pero antes me gustaria a no solo limitarlo a japon sino worldwide a ser posible"
- L2 (2026-10-20) "funcionaria bien con gsi tambien?" → "dale hazlo" (GSI + Esri, test first).
- L3 Spike: Jev stage-1 verdict GSI vs Esri on 23 Japanese sites (industrial, water, other, possible_fire): 23/23 identical. Esri abroad: 8/8 expected (4 steelworks/refineries, 4 forests in CA, PT, GR, US).
- L4 Without ESRI_API_KEY the public Esri endpoint is used: fine for development, production needs an ArcGIS Location Platform key (free tier, attribution required). Weather and timeline times are still JST everywhere (S4).
- L5 (2026-10-20) User chose option 2 ("2"): live = map view with a cap.
- L6 Live over southern Africa (20,-20,35,-5): 13,701 clusters, 150 strongest triaged, 147 alerts (savanna burning season: real vegetation fires, alert fatigue risk abroad), 226 s. Invalid bbox/mode now 400 (was 200 because the check ran inside the SSE generator).
- L7 (2026-10-20) User: "No puedo registrarme en ESRI, no funciona el signup" — production imagery key pending.
- L8 (2026-10-20) S5 request. Verified headless: location granted flies to Lisbon, denied stays on USA, Search this area runs live on the view and hides while running.
- L9 (2026-10-20) S4 + S6 requests. Verified headless with es-AR / America/Argentina/Buenos_Aires: "26 feb 2025, 1:14 p. m. ART"; Lisbon and Ofunato basemaps detailed.
