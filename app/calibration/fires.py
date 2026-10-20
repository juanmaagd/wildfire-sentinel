"""Benchmark fires: real wildfires with VIIRS coverage, checked in the FIRMS archive. The start is the first pass on or
after `day` with a detection within 5 km of (lat, lon); it can be mid-fire: the test is "from what the satellite sees
now, predict the next 30 h". `test` fires are never used to fit parameters."""

# name, lat, lon, UTC day of the first satellite pass, split, note[, box (w, s, e, n) of another fire to exclude]
FIRES = [
    ("ofunato", 39.06, 141.79, "2025-02-26", "train", "Japan, conifer, coastal hills"),
    ("camp", 39.81, -121.44, "2018-11-08", "train", "California, wind-driven, pine + town"),
    ("palisades", 34.07, -118.54, "2025-01-07", "train", "California, chaparral, Santa Ana wind"),
    ("marshall", 39.95, -105.23, "2021-12-30", "train", "Colorado, grassland, extreme wind"),
    ("vina_del_mar", -33.03, -71.47, "2024-02-02", "train", "Chile, eucalyptus and shrub"),
    ("alexandroupolis", 40.90, 25.90, "2023-08-19", "train", "Greece, pine and shrub"),
    ("tenerife", 28.39, -16.45, "2023-08-15", "train", "Canary Islands, pine, steep"),
    ("jasper", 52.75, -118.05, "2024-07-22", "train", "Canada, boreal conifer"),
    ("uiseong", 36.36, 128.69, "2025-03-22", "train", "Korea, pine hills"),
    ("pedrogao", 39.95, -8.20, "2017-06-17", "train", "Portugal, eucalyptus and pine"),
    ("caldor", 38.59, -120.54, "2021-08-14", "train", "California, Sierra conifer"),
    ("norte", 33.49, -117.62, "2026-10-16", "train", "California (San Clemente), coastal shrub + homes"),
    ("arbo", 42.08, -8.22, "2026-10-17", "test", "Spain (Galicia), shrub and pine, low intensity"),
    ("eaton", 34.20, -118.10, "2025-01-08", "test", "California, chaparral + town, Santa Ana wind"),
    ("rhodes", 36.17, 27.92, "2023-07-18", "test", "Greece, pine and shrub"),
    ("imabari", 34.02, 133.03, "2025-03-24", "test", "Japan, hills, mixed forest"),
    ("fort_mcmurray", 56.65, -111.30, "2016-05-01", "test", "Canada, boreal conifer"),
    # The Oliveira de Azemeis fire (separate ignition on 2024-09-14, ICNF "Complexo de Incendios Rurais de Aveiro")
    # burns 10-14 km NNW of this start from +24 h and the 10 km chaining linked it in: excluded by box.
    ("albergaria", 40.70, -8.45, "2024-09-15", "test", "Portugal, eucalyptus", (-8.60, 40.76, -8.30, 41.0)),
]
