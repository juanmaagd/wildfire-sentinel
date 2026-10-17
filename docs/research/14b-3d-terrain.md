# 14b. 3D terrain in the browser (Ofunato, lat 39.04 / lon 141.80)

Goal: 3D terrain view with draped aerial imagery, GeoJSON polygon/line overlays, plain HTML + CDN, no bundler.

## TL;DR

- **Recommendation: MapLibre GL JS 5.6.2 (cdnjs, UMD) + terrarium DEM + GSI seamlessphoto drape.** Fastest path: no adapter, no plugin.
- **Terrarium source:** `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (verified 200 at z14 and z15 for Ofunato). Mapterhorn is an alternative (`https://tiles.mapterhorn.com/tilejson.json`, `encoding: terrarium`, `tileSize: 512`, verified).
- **GSI `dem_png` is not drop-in.** Its no-data/sea sentinel (R=128, G=0, B=0) decodes as about -83,886 m under a linear decoder. About 19% of the Ofunato z14 tile is sentinel (see Section 1). Use it only behind an `addProtocol` fix.
- **Do not use `maplibre-gl-gsi-terrain`** (archived, README points to Mapterhorn).
- Use cdnjs `maplibre-gl@5.6.2`. unpkg `maplibre-gl@6.14.0/dist/maplibre-gl.js` returns **404** (6.x ships `.mjs` only).

## 1. Elevation data

### GSI (国土地理院) tiles

| Item | Value | Status |
|---|---|---|
| dem_png URL | `https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png` | **Verified**: z14 tile 14645/6259 returns 200, `image/png`, 256x256 RGB |
| dem_png max zoom | 14 | **Verified**: z15 returns 404. Also `GSI_MAX_TERRAIN_LEVEL = 14` in `gsi-cyberjapan/gsimaps/globe/resource/JapanGSITerrainProvider.js` (line ~15) |
| dem5a_png | `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png` | **Verified** 200 at z14 and z15 (Ofunato). Max zoom above 15 not tested |
| Encoding | `h = R*65536 + G*256 + B`; `h*0.01` m if `h < 2^23`; `h == 2^23` = no data; `h > 2^23` = `(h - 2^24)*0.01` | Formula from GSI demo source (`JapanGSITerrainProvider.js`, `pow2_23` / `pow2_24`). Official spec page `https://maps.gsi.go.jp/development/demtile.html` is JS-rendered and returned only a heading, so the spec is cited via the source code |
| Decoded sanity check | z14 Ofunato tile: 53,158 valid px, heights 0.0 to 220.3 m | Verified (own decode, Python, stdlib) |
| Sentinel share | z14 Ofunato tile: 12,378 / 65,536 px (18.9%) have R=128,G=0,B=0 | Verified. Every R>=128 pixel in this tile is the sentinel, so it is sea/no-data |
| Attribution | 出典: 国土地理院 (use "地理院タイル" link to `https://maps.gsi.go.jp/development/ichiran.html`) | Link verified in plugin README. Exact license wording **unverified**. Check `https://maps.gsi.go.jp/development/ichiran.html` and the terms page before publishing |
| Aerial photo | `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg` | **Verified** 200 at z14 Ofunato (17 KB). Max zoom 18 per plugin README (`maxzoom: 18`), not independently tested |

### Global alternatives (no key)

| Source | URL | Encoding | Status |
|---|---|---|---|
| AWS Terrain Tiles (Mapzen terrarium) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | terrarium | **Verified** 200 at z10, z14, z15 (Ofunato) |
| Mapterhorn | `https://tiles.mapterhorn.com/tilejson.json` (tiles `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`) | `terrarium`, tileSize 512 | **Verified** tilejson 200. Used in the MapLibre 3D terrain example |

Terrarium decoding: `h = R*256 + G + B/256 - 32768`. MapLibre has this built in (`encoding: 'terrarium'`).

## 2. Rendering options (ranked for speed-to-demo, plain HTML)

| Rank | Option | CDN (pinned) | No key? | Terrain from GSI | Overlays | Effort | Gotchas |
|---|---|---|---|---|---|---|---|
| 1 | **MapLibre GL JS 5.6.2** + terrarium DEM | `https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.2/maplibre-gl.js` (**200 verified**) + `.css` | Yes | Not native (see below). Use terrarium, or GSI with `addProtocol` | GeoJSON `fill` / `line` / `circle` drape on terrain automatically; animate via `source.setData()` | ~1 h | 6.x: unpkg `dist/maplibre-gl.js` 404, only `.mjs`. 6.x adds `encoding: 'custom'` (`redFactor`, `greenFactor`, `blueFactor`, `baseShift`; verified in 6.14.0 `.d.ts`) but this is linear and does not handle the sentinel |
| 2 | MapLibre + `maplibre-gl-gsi-terrain` plugin | `https://www.unpkg.com/maplibre-gl-gsi-terrain@2.3.0/dist/terrain.js` (unpkg 302 verified) | Yes | Yes (`useGsiTerrainSource(maplibregl.addProtocol)`) | Same as 1 | ~30 min | **Repo archived** (`archived: true`, last push 2026-05-11). README recommends Mapterhorn. Usable for a demo, do not depend on it |
| 3 | deck.gl `TerrainLayer` (`@deck.gl/geo-layers`) | `https://unpkg.com/deck.gl@9.1.0/dist.min.js` (200 verified) | Yes | Possible with `elevationDecoder` | Strong 3D layers, but no native map basemap. Would need a separate basemap | 2-3 h | Decoder params **unverified** (grep of 9.1.0 typings returned nothing). Do not copy values from memory |
| 4 | CesiumJS (no Ion) | `https://cesium.com/downloads/cesiumjs/releases/1.124/Build/Cesium/Cesium.js` (200 verified); npm `cesium@1.124.0` (200) | Cesium default imagery needs Ion. Custom providers do not | Yes: GSI's own demo uses a custom `JapanGSITerrainProvider` (`gsi-cyberjapan/gsimaps/globe/resource/JapanGSITerrainProvider.js`, ~250 KB, uses `Cesium.Credit('')`, no Ion call) | Entities / polygons with heights | 3-4 h | Ion-token-free path is **believed** from the provider code, not run. Largest file, slowest to set up |
| 5 | three.js DIY heightmap | `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js` (200 verified) | Yes | Decode DEM PNG to a `PlaneGeometry` displacement, drape photo as texture | Full control, all overlays are your code | 1-2 days | Tile stitching, seams, LOD all on you. Not a demo-day option |

Notes:
- The GSI official demo repo `gsi-cyberjapan/gsimaps` (BSD-2-Clause, pushed 2026-10-08) has `js/index_3d.js` and `globe/` (Cesium). Its `gsimaps-vector-experiment` repo has `demloader.js` (hillshade and DEM loader, not 3D). These are GSI's own references.
- Japanese community search (Qiita / Zenn / GitHub topics) returned nothing usable (search engines degraded during this session). Not verified.

## 3. Example repos and demos

| Resource | URL | What it is | Status |
|---|---|---|---|
| MapLibre 3D terrain example | https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/ | Official terrain + hillshade, `setTerrain`-style `terrain` in style, Mapterhorn DEM | **Verified** (fetched) |
| MapLibre examples index | https://maplibre.org/maplibre-gl-js/docs/examples/ | Index | Verified 200 |
| maplibre-gl-gsi-terrain | https://github.com/mug-jp/maplibre-gl-gsi-terrain | GSI DEM + seamlessphoto for MapLibre, `addProtocol` | **Archived.** Verified via `gh api` |
| GSI official 3D / globe demos | https://github.com/gsi-cyberjapan/gsimaps | `js/index_3d.js`, `globe/` (Cesium, `JapanGSITerrainProvider.js`) | Verified via `gh api` |
| GSI vector experiment | https://github.com/gsi-cyberjapan/gsimaps-vector-experiment | DEM loader, hillshade | Verified via `gh api` |
| GSI maps | https://maps.gsi.go.jp/ | Reference viewer (has 3D display) | Verified 200 |

## 4. Recommended approach and sketch

**Use MapLibre 5.6.2 + terrarium DEM + GSI seamlessphoto.** Start with terrarium so the demo is not blocked by GSI's sea sentinel. Upgrade to GSI `dem_png` only with the `addProtocol` decode fix (zero the sentinel and re-encode as terrarium). Not tested.

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>3D terrain test</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.2/maplibre-gl.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.2/maplibre-gl.js"></script>
<style>html,body,#map{margin:0;height:100%}</style></head>
<body><div id="map"></div>
<script>
// Hypothetical fire perimeter around Ofunato (lon, lat), illustrative only
const perimeter = (k) => ({ type:'FeatureCollection', features:[{ type:'Feature', properties:{},
  geometry:{ type:'Polygon', coordinates:[[[141.76,39.02],[141.80+0.02*k,39.02],[141.84,39.06],[141.78,39.07],[141.76,39.02]]] }}]});
const line = { type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates:[[141.74,39.00],[141.80,39.04],[141.86,39.09]] }};

const map = new maplibregl.Map({
  container: 'map', center: [141.80, 39.04], zoom: 12.5, pitch: 60, bearing: -20, maxPitch: 85,
  style: { version: 8,
    sources: {
      photo: { type:'raster', tileSize:256, maxzoom:18,
        tiles:['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
        attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>' },
      dem: { type:'raster-dem', encoding:'terrarium', tileSize:256, maxzoom:15,
        tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] }
    },
    layers: [{ id:'photo', type:'raster', source:'photo' }] }
});

map.on('load', () => {
  map.setTerrain({ source:'dem', exaggeration:1.5 });
  map.addSource('fire', { type:'geojson', data: perimeter(0) });
  map.addLayer({ id:'fire-fill', type:'fill', source:'fire', paint:{'fill-color':'#ff3b1f','fill-opacity':0.35} });
  map.addSource('route', { type:'geojson', data: line });
  map.addLayer({ id:'route-line', type:'line', source:'route', paint:{'line-color':'#ffd000','line-width':3} });
  let k = 0; // animate perimeter growth
  setInterval(() => { k = (k + 1) % 50; map.getSource('fire').setData(perimeter(k)); }, 200);
});
</script></body></html>
```

Caveats for the sketch (not executed in a browser):
- `setTerrain` with a `raster-dem` in 5.x: the style-level and `setTerrain` APIs are believed equivalent; confirm by opening the page.
- The `fire` polygon is a fake shape. Replace with real perimeter GeoJSON.
- `map.addLayer` with `fill` drapes on terrain automatically; no extra step.

## 5. GSI sea sentinel fix (if GSI is required)

| Step | Detail |
|---|---|
| Problem | `R=128,G=0,B=0` (`h = 2^23`) is no-data. Linear MapLibre decoding gives about -83,886 m |
| Fix | `addProtocol('gsidem', ...)`: decode PNG on a canvas, set pixels with `h == 2^23` to height 0, then re-encode to terrarium RGB (`R=(h+32768)>>8`, etc.) and return the bytes. Use `encoding:'terrarium'` on `gsidem://...` |
| Cost | About 45 min. Untested |
| Status | Plugin `maplibre-gl-gsi-terrain` implements this, but it is archived. Reading its `src/terrain.ts` may help. Not verified |

## Unverified items

- deck.gl TerrainLayer decoder parameters (not checked).
- CesiumJS no-Ion path works in practice (inferred from provider source, not run).
- GSI attribution / licence wording.
- MapLibre 5.6.2 running the sketch in a browser (not run).
- terrarium max zoom 15 (verified only as 200 at z15 for one tile).
- seamlessphoto max zoom 18 (from plugin README).
- Japanese community repos and demos (search returned none).
