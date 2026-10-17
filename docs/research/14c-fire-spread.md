# 14c — Fire-spread prediction for a didactic demo

Scope: next-hours perimeters (+1h, +3h, +6h) from ignition, wind, slope, fuel, dryness. Didactic, not operational.
Legend: **[V]** verified by fetching the source this session. **[U]** unverified (from memory or not reachable). Primary papers (USDA INT-115/INT-305, IEEE Alexandridis 2008) returned 403/418 and could not be read.

## 1. Models

| Model | Idea (key formula) | Uses wind | Uses slope | Uses fuel/dryness | Fit for today |
|---|---|---|---|---|---|
| Rothermel surface model (1972) | ROS = R0 (1 + φw + φs); R0 from fuel, moisture; φw wind term; φs = 5.275 β^-0.3 tan²φ **[U]** | yes | yes | yes (full) | Too heavy to implement from scratch; use as a lookup of R0 only |
| Elliptical (Anderson 1983) | Head ROS from Rothermel; shape from length-to-breadth LB(U) = 0.936e^{0.2566U} + 0.461e^{-0.1548U} − 0.397 (U in mph) **[U]**; e = √(LB²−1)/LB; directional R(Δ) = R_head(1−e)/(1−e·cosΔ) **[U]** | yes (via LB) | via R_head | via R0 | **Best fit**: one formula gives direction-dependent speed |
| Huygens / FARSITE | Wavelets from every front point, each expanded at local ROS **[U]** | yes | yes | yes | Too complex for today; FARSITE is the reference (Finney 1998, not fetched) |
| Cellular automata (Alexandridis et al. 2008) | p_burn = p_h(1+p_veg)(1+p_den)·p_w·p_s, wind/slope as multiplicative factors **[U]** | yes | yes | yes | Simple, but grid-noise artifacts and needs many runs for smooth perimeters |
| Canadian FBP | Empirical ROS per fuel type, then ellipse **[U]** | yes | yes | yes (FFMC/DMC/DC) | Needs fuel-specific tables we do not have |
| Minimum travel time (MTT, Finney) | Dijkstra/Fast-marching over a directional-speed field; contours of arrival time = perimeters **[U]** | yes | yes | yes | Best for an explainable demo: one shortest-path run gives all three perimeters |

**Simplest model that uses all four inputs:** elliptical ROS (Anderson shape from wind) inside a minimum-travel-time grid. Slope and fuel scale the head speed; wind sets both speed and ellipse shape.

## 2. Open-source implementations

Checked with `gh repo view` / `gh search repos` and `wigolo fetch` on 2026-10-17.

| Project | URL | Stars | Last update | License | Lang | Inputs | Coarse inputs, seconds? | Integration effort |
|---|---|---|---|---|---|---|---|---|
| ForeFire [V] | https://github.com/forefireAPI/forefire | 106 | 2026-10-11 | GPL-3.0 | C++ core, `pip install forefire` (`pyforefire`) | Scripted domains, layers (e.g. `Iso` propagation), wind/fuel layers, NetCDF | Likely yes for an `Iso` model; not tested | Medium-high: learn `.ff` scripting or Python API; GPL-3 constrains distribution |
| Cell2Fire [V] | https://github.com/cell2fire/Cell2Fire | 88 | 2026-10-05 | GPL-3.0 | Python + C++ (needs Boost, Eigen, make) | Cell grid: fuel, weather, moisture, topography per cell; elliptical spread per cell **[V]** | Yes in principle; README says "For Research Use Only" **[V]** | High: C++ build plus its instance-folder format |
| pyretechnics [V] | https://github.com/pyregence/pyretechnics | 24 | 2026-10-06 | Pyretechnics Community License (noncommercial/research; commercial needs agreement) **[V]** | Python, NumPy arrays | Implements Rothermel surface equations and an ELMFIRE level-set spread on arrays **[V]** | Yes, arrays are our data shape | Medium: cleanest Python API for the physics; check license for your use |
| pyrothermel [V] | https://github.com/j-tenny/pyrothermel | 10 | 2026-09-15 | MIT | Python bindings to C++ Behave | Rothermel ROS from fuel model + moisture + wind + slope **[V]** | Yes (per-cell ROS) | Medium: needs a compile |
| firelab/behave [V] | https://github.com/firelab/behave | 23 | 2026-10-13 | "Other" (check) | C++ | Full extended Rothermel (BehavePlus engine) **[V]** | Yes | High: C++ build; reference, not a quick demo |
| emxsys/behave [V] | https://github.com/emxsys/behave | 14 | 2026-06-06 | MIT | JavaScript | Rothermel ROS calculations in JS **[V]** | Yes, per-cell in browser | Low-medium: usable for the ROS function in a web UI |
| PyFireStation [V] | https://github.com/PyFireCoimbra/PyFireStation | 12 | 2026-03-12 | GPL-3.0 | Python | Rothermel-based fire propagation **[V]** | Unverified | Medium; small community |
| Browser CA / WebGL fire demos | not found | — | — | — | — | — | — | My GitHub search for "fire spread cellular automata" returned no repos; not verified |

Not recommended for today: the deep-learning repos (e.g. WildfireSpreadTS, 70 stars, MIT) predict from satellite data, not physics, and need trained weights.

## 3. Calibration sanity

**No verified numbers yet.** The primary sources (Rothermel 1972, Anderson 1983, Alexandridis 2008) were blocked. Treat everything in this section as [U] until checked against USDA/NWCG fuel-model tables.

| Item | Claim | Status |
|---|---|---|
| Grass vs conifer ROS under strong wind | Grass can reach tens to 100+ m/min; forest surface fire usually lower, crown fire much faster | [U] order-of-magnitude |
| Wind effect | ROS roughly grows with wind (Rothermel φw is a power law in U, exponent >1) | [U] direction only |
| Slope rule | "Spread roughly doubles per ~10° upslope" is a common rule of thumb, not a law; Rothermel's φs grows with tan²φ | [U] rule of thumb |
| Elliptical shape | LB ≈ 1 at zero wind, rising with wind speed (Anderson) | [U] formula from memory; sanity-check that LB(0)=1 holds (it does for the formula above) |

Use the rule-of-thumb constants only as didactic defaults and say so on the slide.

## 4. Recommendation for today: elliptical ROS on a minimum-travel-time grid

Approach: each cell has a head ROS from fuel, dryness, wind and slope. A direction-dependent ellipse (Anderson shape from wind) sets the speed for each of 8 neighbour moves. Dijkstra gives arrival times; contours of arrival time at 60, 180, 360 min give the perimeters. Output is GeoJSON.

Pseudo-code (Python, numpy + scikit-image). Constants are placeholders, not calibrated:

```python
import heapq, math
import numpy as np
from skimage import measure

def simulate(dem, cell_m, ignition, wind_ms, wind_from_deg, fuel, dryness,
             lat0, lon0, hours=(1, 3, 6)):
    """dem: elevation (m), row 0 = north. ignition: (row, col). fuel, dryness in [0,1]."""
    H, W = dem.shape
    gy, gx = np.gradient(dem, cell_m)                    # gy per row (south), gx per col (east)
    slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))
    up_e, up_n = gx, -gy                                 # uphill vector (east, north)
    n = np.hypot(up_e, up_n) + 1e-9
    up_e, up_n = up_e / n, up_n / n
    to = math.radians((wind_from_deg + 180) % 360)       # direction the wind blows toward
    we, wn = math.sin(to), math.cos(to)
    U_mph = wind_ms * 2.237
    R0 = 5 + 40 * fuel * dryness                         # base ROS m/min (placeholder)
    slope_mult = 2 ** (slope_deg * (up_e * we + up_n * wn) / 10)   # doubles per 10 deg upslope
    R_head = R0 * (1 + 0.15 * wind_ms * fuel) * slope_mult          # wind term placeholder
    LB = max(1.0, 0.936 * math.exp(0.2566 * U_mph) + 0.461 * math.exp(-0.1548 * U_mph) - 0.397)
    e = math.sqrt(LB * LB - 1) / LB                      # eccentricity of the ellipse
    moves = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr, dc) != (0, 0)]
    T = np.full((H, W), np.inf); T[ignition] = 0.0
    pq = [(0.0, *ignition)]
    while pq:
        t, r, c = heapq.heappop(pq)
        if t > T[r, c]:
            continue
        for dr, dc in moves:
            rr, cc = r + dr, c + dc
            if not (0 <= rr < H and 0 <= cc < W):
                continue
            east, north = dc, -dr
            L = math.hypot(east, north)
            cos_d = (east * we + north * wn) / L         # angle between move and wind
            ros = R_head[r, c] * (1 - e) / (1 - e * cos_d)   # elliptical directional ROS
            nt = t + cell_m * L / ros
            if nt < T[rr, cc]:
                T[rr, cc] = nt
                heapq.heappush(pq, (nt, rr, cc))
    deg_lat = cell_m / 111320
    deg_lon = cell_m / (111320 * math.cos(math.radians(lat0)))
    out = {}
    for h in hours:
        mask = np.pad((T <= 60 * h).astype(float), 1)    # pad so contours close at the edges
        ring = max(measure.find_contours(mask, 0.5), key=len)
        coords = [[lon0 + (c - 1) * deg_lon, lat0 - (r - 1) * deg_lat] for r, c in ring]
        out[f"+{h}h"] = {"type": "Feature", "properties": {"hours": h},
                         "geometry": {"type": "Polygon", "coordinates": [coords]}}
    return {"type": "FeatureCollection", "features": list(out.values())}
```

Notes on the sketch:
- Speed is taken from the cell being left; a finer grid (10–30 m) costs more time but reduces grid bias.
- Dijkstra on an 8-neighbour grid has directional bias (a known limit of graph-based fire models). The ellipse shape partly compensates; it does not remove it.
- The sketch is untested. Expected runtime for ~300×300 cells is a few seconds in pure Python [U].

## 5. Limits (say these on the slide)

- Didactic: constants (R0, wind term, slope rule) are placeholders, not calibrated to fuel models.
- Uniform wind over the whole domain; no fire-atmosphere feedback, no spotting, no crown fire.
- Fuel and dryness are scalar multipliers from categorical photo judgements, not fuel-model tables.
- Contours ignore barriers (rivers, roads) and the moment the front reaches a burnt-out cell.
- Grid direction bias and a 60–360 min horizon only; forecast accuracy is not evaluated.
- If the team wants a proper engine instead: ForeFire (`pip install forefire`, GPL-3) is the quickest real option, but its scripting model needs a day of learning.

## 6. Open items

- Verify the Anderson LB formula and Rothermel φs against INT-115 / INT-305 (both blocked here).
- Verify slope rule and ROS ranges with NWCG or Scott & Burgan fuel-model tables.
- Check Alexandridis 2008 p-factor form (IEEE blocked here).
- Check firelab/behave license ("Other") before reuse.
- No browser cellular-automata fire repo was found; not verified that none exist.
