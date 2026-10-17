"""Jev questions. Stage 1 is one cheap request per hotspot; stage 2 fans out over several images.

Image scales: `close` ≈ 1.8 km across (GSI z16), `wide` ≈ 7 km across (GSI z14), `satellite` ≈ 50 km (VIIRS true color).
FIRMS/VIIRS geolocation is only good to ~375 m, so stage 1 asks about the area around the center, not the exact pixel.
"""

from typesafe_sdk import Choice, Noul, Score

SENTINEL = {
    "industrial_nearby": Noul(
        instructions=(
            "A satellite detected a heat source near the center of the aerial photo `close` (about 1.8 km across). "
            "Is there an industrial facility within about 400 m of the center: factory, steel mill, refinery, "
            "power plant, incinerator, chimneys, storage tanks or large industrial roofs?"
        )
    ),
    "vegetation_nearby": Noul(
        instructions=(
            "Is there forest, bush, grassland or other natural vegetation within about 400 m of the center "
            "of the aerial photo `close` (about 1.8 km across)?"
        )
    ),
    "houses_nearby": Noul(instructions="Are residential houses visible anywhere in the aerial photo `close`?"),
    "center_is_open_water": Noul(
        instructions="Is the center of the aerial photo `close` open water (sea, lake or wide river) with no land within about 200 m?"
    ),
}

PROBE = {
    "fuel_type": Choice(
        instructions="What vegetation dominates around the center of the aerial photo `close`?",
        criteria={
            "conifer_forest": "Dense, dark, uniform conifer plantation (cedar, cypress, pine).",
            "broadleaf_or_mixed_forest": "Broadleaf or mixed forest with varied, lighter canopy.",
            "grass_or_shrub": "Grassland, bush, shrubs or young regrowth.",
            "farmland": "Agricultural fields, paddies or orchards.",
            "built_up_or_bare": "Buildings, roads, bare soil or rock.",
        },
    ),
    "vegetation_continuity": Score(
        instructions="In the wide aerial photo `wide` (about 7 km across), how continuous is the vegetation around the center?",
        criteria=[
            "Isolated patches of vegetation surrounded by fields, buildings or water.",
            "Patchy vegetation broken by fields, roads or settlements.",
            "Mostly continuous forest with some breaks.",
            "Continuous forest over most of the image, connecting hills and valleys.",
        ],
    ),
    "settlement_distance": Choice(
        instructions=(
            "In the wide aerial photo `wide` (about 7 km across, the center is the fire location), "
            "how far from the center is the nearest group of houses?"
        ),
        criteria={
            "within_500m": "Houses within about 500 m of the center (a 14th of the image width).",
            "500m_to_1500m": "Nearest houses about 500 m to 1.5 km from the center.",
            "1500m_to_3500m": "Nearest houses about 1.5 to 3.5 km from the center (near the image edges).",
            "none_visible": "No houses visible in the image.",
        },
    ),
    "settlement_direction": Choice(
        instructions=(
            "In the wide aerial photo `wide` (north is up), in which direction from the center is the "
            "nearest group of houses?"
        ),
        criteria={
            "N": "North (up).", "NE": "North-east (up-right).", "E": "East (right).", "SE": "South-east (down-right).",
            "S": "South (down).", "SW": "South-west (down-left).", "W": "West (left).", "NW": "North-west (up-left).",
            "none": "No houses visible.",
        },
    ),
    "settlement_size": Score(
        instructions="In the wide aerial photo `wide`, how large is the nearest settlement to the center?",
        criteria=[
            "No houses visible.",
            "A few isolated houses or farms.",
            "A village or small fishing port.",
            "A town with many streets.",
            "A city or dense urban area.",
        ],
    ),
    "terrain": Score(
        instructions="In the wide aerial photo `wide`, what is the terrain around the center like?",
        criteria=["Flat plain.", "Gentle hills.", "Hilly with valleys.", "Steep mountains and ridges."],
    ),
    "firebreak": Noul(
        instructions=(
            "In the wide aerial photo `wide`, is there a major road, wide river or cleared strip "
            "between the center and the nearest houses that could slow a fire?"
        )
    ),
    "water_source": Noul(
        instructions=(
            "In the wide aerial photo `wide`, is there a lake, reservoir, wide river or sea near the center "
            "that firefighting helicopters could scoop water from?"
        )
    ),
    "smoke_plume": Noul(
        instructions=(
            "Is a smoke plume visible in the satellite image `satellite` (a grey or brown haze streaming from a "
            "point near the center, distinct from white clouds)?"
        )
    ),
    "cloud_cover": Score(
        instructions="How much of the satellite image `satellite` is covered by clouds?",
        criteria=["Clear.", "Partly cloudy.", "Mostly cloudy.", "Overcast."],
    ),
}
