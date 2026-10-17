# 07 — Brainstorm

Status: **seed ideas only.** To be expanded with the team's own ideas.

## Scorecard (1–5 each, mirrors the judging criteria)

| Idea | Real problem | Works by 16:00 | Tech impressive | Pitchable in 3 min | Creative | Total |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Tie-breaker: which one can we demo end-to-end with the least risk?

## Seed ideas (starting points, not decisions)

1. **Meeting-to-memory agent** — feed meeting notes/transcripts; ai& extracts people, decisions, commitments into a Neo4j graph; ask "what did we promise client X and who owns it?" with the path shown.
2. **Onboarding graph for Japanese companies** — internal docs → knowledge graph; new hire asks questions; data stays in Japan (ai& sovereignty angle).
3. **Receipt/document → relationships** — vision model extracts entities from photos/PDFs (invoices, contracts) into a graph; detect duplicates, suppliers, anomalies across documents.
4. **Personal agent with long-term memory** — an assistant that remembers the user across sessions in a visible graph, and explains why it recommends something.

## Our ideas

### Decided stack

**Jev (core, real-time judgments) + ai& (reasoning) + Neo4j (memory).** Jev is the centerpiece of the project; the sponsors stay load-bearing. Idea still open.

### Direction chosen to explore: real-time vision with Jev (see [08-typesafe-jev.md](08-typesafe-jev.md))

Architecture: webcam frames → **Jev** (fast judgments, ~150 ms) → events into **Neo4j** (memory over time) → **ai&** (reasoning, reports, escalations on low confidence).

Candidate ideas:

| # | Idea | User / problem | Jev does | Neo4j does | ai& does |
| --- | --- | --- | --- | --- | --- |
| J1 | **Kitchen hygiene copilot** | Small restaurants in Japan must keep HACCP-style hygiene records; nobody has time | Noul/Choice per frame: gloves, hand-washing, raw/cooked separation; Box to highlight | Timeline of events per station/person/shift | Writes the daily hygiene log, explains violations |
| J2 | **Elderly "mimamori" monitor** | Aging Japan, people living alone; families worry | Fall detected? Unusual posture? Activity Choice | Learns daily routine as a graph (who, where, when) | Decides if a deviation is worrying, writes the alert to family |
| J3 | **Site safety (PPE) watcher** | Construction/warehouse safety | Helmet/vest Noul, Box on the person, risk Score | Incidents linked to zones, times, crews | Weekly safety report, near-miss patterns |
| J4 | **Live "screen copilot"** | Knowledge workers lose context | Classify what's on screen every few seconds | Graph of apps, projects, people, documents touched | "What was I doing on project X yesterday?" |
| J5 | **Game-playing / game-referee agent** | Creative/fun demo | Reads game frames and picks moves in real time | Memory of opponent's patterns | Strategy commentary |

Scoring of these against the criteria: pending, with the user.

### User's ideas (round 2)

| # | Idea | Data | Plays to Jev's strength? | Risks |
| --- | --- | --- | --- | --- |
| U1 | **Wildfire / disaster detection from satellites** | NASA GIBS (no key), FIRMS (free key), Himawari (every 10 min). See [09](09-image-data-sources.md) | Partly: cost/scale triage, not real-time (images refresh 10 min–daily) | Jev images are beta and satellite tiles may be out of distribution → test first. FIRMS already detects fires; our value must be *triage/verification*, not detection |
| U2 | **Home/backyard camera guardian** (intruder, child falling into the pool) | Laptop webcam + recorded clips | Yes: 150 ms per frame is exactly the use case | Seen on X already (less creative); drowning can't be demoed live; privacy of home images |

Sharper version of U1: **"Hotspot triage"** — FIRMS/VIIRS returns many hotspots in Japan, most are factories, volcanoes or false alarms. For each hotspot, fetch the satellite tile, Jev asks: smoke plume visible? vegetation or industrial? near houses? → Neo4j links hotspots to prefectures, forests, settlements and past events → ai& writes the Japanese alert for the municipality. Context: the Feb 2025 Ofunato (Iwate) wildfire, Japan's largest in decades.

**Status: chosen as the main idea (user agreed). Plan B: U3.**

Refined after the spike (see [09](09-image-data-sources.md)): Jev judges the **GSI aerial photo** at each hotspot (forest / industrial / farmland / residential, houses nearby?) plus the satellite tile when cloud-free (smoke? cloud cover?). Daily satellite smoke alone is too weak.

| # | Idea | Data | Notes |
| --- | --- | --- | --- |
| U3 | **Mt. Fuji visibility** (plan B) | 24/7 YouTube live streams pointed at Fuji; weather open data | Real-time fit for Jev (Score: fully visible → hidden); useful for tourists. Frames via `yt-dlp` + `ffmpeg` |
| U4 | Weather/climate overlays | Open-Meteo (free, no key), JMA open data, GIBS heat layers | Supporting data, not a standalone idea |
