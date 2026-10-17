# 09 — Open Image Data Sources (verified 2026-10-17)

Sources of images Jev could judge, checked live today.

## Satellite

| Source | What | Access | Refresh | Resolution | Verified |
| --- | --- | --- | --- | --- | --- |
| **NASA GIBS / Worldview Snapshot API** | True-color imagery + fire/thermal-anomaly layers as ready JPG/PNG | **No key.** `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor,VIIRS_NOAA20_Thermal_Anomalies_375m_All&CRS=EPSG:4326&TIME=YYYY-MM-DD&BBOX=lat_min,lon_min,lat_max,lon_max&FORMAT=image/jpeg&WIDTH=800&HEIGHT=711` | Daily (polar orbiters) | 250 m (MODIS), 375 m (VIIRS) | ✅ Returned a Japan image with red hotspot dots |
| **NASA FIRMS API** | Fire hotspots as CSV (lat/lon, brightness, confidence, time) for an area | Free `MAP_KEY` by email: https://firms.modaps.eosdis.nasa.gov/api/map_key/ | Near real-time (~3 h) | 375 m | ⚠️ Needs key (DEMO_KEY rejected) |
| **Himawari-9 (JMA) on AWS** | Geostationary imagery of East Asia | Public S3 bucket `noaa-himawari`, no account | **Every 10 min** (full disk), 2.5 min regions | ~0.5–2 km | Raw HSD format, needs conversion; harder in one day |

Notes:
- Many VIIRS "hotspots" in Japan are industrial sites, volcanoes or false positives → a triage problem.
- Satellite refresh (10 min to daily) is the bottleneck, not model latency. Jev's value here is **cost and scale** (triage thousands of tiles/hotspots cheaply), not 150 ms.

## Aerial photos of Japan (GSI 国土地理院)

| Source | What | Access | Verified |
| --- | --- | --- | --- |
| **GSI seamless aerial photo tiles** | High-resolution orthophotos of all of Japan | **No key.** `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg` (XYZ tiles, z16 ≈ 2.4 m/px, 256×256) | ✅ Refinery area vs Ofunato forest are trivially distinguishable |

Attribution required: "出典：国土地理院". Static imagery (not real-time): use it for **land-use context** at a hotspot location.

## Spike findings (2026-10-17)

- **Daily satellite true-color (MODIS/VIIRS) is a weak signal for smoke.** For the Ofunato fire (27 Feb – 3 Mar 2025) the tiles were dominated by clouds, and smoke was not clearly visible even to a human. Don't build the core judgment on "is there smoke in this daily tile".
- **GSI aerial photos are a strong signal for context.** Industrial vs forest vs residential is obvious at z16.
- Therefore the triage should rely on: FIRMS hotspot (thermal, already detected) + GSI aerial photo of the location (what is burning?) + optional satellite tile (smoke, if cloud-free).
- Test images saved in `spike/images/`.

### Jev results (`spike/jev_test.py`, model `jev-1.14.0`)

GSI tiles are 256 px and Jev needs **280–1568 px per side**, so `spike/gsi.py` stitches a 3×3 mosaic (768 px, ~1.8 km around the point at z16).

| Image | Question | Answer | Latency |
| --- | --- | --- | --- |
| Ofunato forest (aerial) | land use | **forest, p=1.00**, confidence 1.0; houses visible 0.13 | 307 ms |
| Ofunato town (aerial) | land use | **residential, p=0.94**, confidence 0.92; houses 0.96 | 182 ms |
| Ichihara/Keiyo (aerial, mixed tanks + factories + houses) | land use | industrial 0.48 / residential 0.52, **confidence 0.40** | 250 ms |
| Satellite tiles (MODIS/VIIRS) | cloud cover | plausible (mostly cloudy/overcast where clouds dominate) | ~155 ms |
| Satellite tiles | smoke plume | ~0.2 on all (consistent with no visible smoke) | ~155 ms |

Takeaways:
- **Latency 150–300 ms per request** including image upload. ✅
- Land-use judgment works on clear cases; on genuinely mixed areas it is honestly uncertain (low confidence) → use **confidence-gated routing**: low confidence → escalate to an ai& vision model (`glm-5.3-flash` / `qwen3.8-27b`).
- Next improvement: ask about **the center of the image** (where the hotspot is), add a `mixed` option, and ask separate Nouls (`storage_tanks`, `factory_roofs`, `forest_within_500m`).

### End-to-end spike with real data (`spike/triage_test.py`)

FIRMS key works (stored in `.env` as `MAP_KEYS`). Japan bbox, VIIRS NOAA-20 NRT, last 2 days: **155 detections → 95 unique ~1 km cells**. Top 8 by FRP through GSI mosaic + Jev:

| Hotspot | Jev center land use | Confidence | Real place (manual check) |
| --- | --- | --- | --- |
| 34.71, 134.82 (×3) | industrial | 0.90–1.00 | Nippon Steel Hirohata, Himeji (verified visually) |
| 33.26, 131.65 / 131.64 | industrial | 0.94 / 1.00 | Steel works, Oita |
| 33.79, 130.99 | industrial | 0.90 | Kitakyushu industrial area |
| 42.34, 140.99 | industrial | 0.60 | Muroran steel works |
| 35.10, 128.86 | — | — | Busan, Korea: no GSI tile → **GSI acts as a free "is it in Japan" filter** |

**Conclusion: the pitch is validated with today's real data.** The strongest hotspots in Japan are steel mills, i.e. false alarms for wildfire purposes, and Jev classifies them at ~200 ms each.

## Public cameras in Japan

| Source | What | Notes |
| --- | --- | --- |
| **JMA volcano monitoring cameras** | Still images from cameras on active volcanoes | https://www.data.jma.go.jp/vois/data/obs/volcam/volcam.php — page builds image URLs in JS; needs light scraping |
| **MLIT river cameras** (川の防災情報) | River level cameras across Japan | Public web pages; refresh every few minutes |
| **Japan Live Watch** | Aggregator of public disaster cameras (rivers, roads, volcanoes, coasts) | https://japanlivewatch.com — useful to find camera URLs |

## Own camera

- **Laptop webcam** (OpenCV / browser `getUserMedia`) → frames every ~0.5–1 s → Jev. Zero external dependency, live at the judge's table.
- Pre-recorded clips for scenarios that cannot be staged live (e.g. pool accident): sample frames from video.
