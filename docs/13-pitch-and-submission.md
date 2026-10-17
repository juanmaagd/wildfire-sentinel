# 13 — Pitch and submission (Wildfire Sentinel)

Written 2026-10-17 for the 16:00 JST deadline. Sources: `docs/02`, `docs/05`, `docs/10`, `docs/12`, `odd/tasks/wildfire-sentinel.md`.
Verified by the parent against measured data: 77% = 55 of 71 live sites; Ofunato 2025-02-26 14:00 JST gusts 24.7 m/s (Open-Meteo archive); stage-2 probe 190–530 ms for 11 questions on 3 images; mock mode `?mock=1`. Only Jev/TypeSafe hosting location remains unverified.

---

## 1. Pitch script (3:00)

Spoken lines are plain text. Stage directions are in [brackets]. Drill numbers come from today's live forecast, so read them from the screen instead of memorising them.

**0:00–0:20 — Problem**

"NASA satellites flag dozens of heat spots across Japan every day. Most of them are steel mills and factories. A fire officer cannot check each one by hand, and when a real fire starts, the first hours decide everything."

**0:20–0:40 — Live: filtering**

[Click "Live". Point at the Hotspots / Filtered / Fires counters.]

"These are today's real hotspots. Jev looks at the aerial photo of each one in about 200 milliseconds and filters the factories out. Sites it has seen before come straight from Neo4j memory, with no model call."

**0:40–1:35 — Drill: an everyday fire**

[Click "Drill · Ashikaga". The alert toast appears.]

"Now an everyday case: a brush fire on the slope above central Ashikaga, where the 2021 Mt. Ryōgai fire burned. The alert is raised in under a second. Jev then asks about ten questions about three images, fuel, houses, terrain, and code turns the answers and the live weather into danger, spread and exposure scores."

[Open the alert → "3D spread prediction". Press play.]

"This is the spread on real terrain with today's hourly forecast. Unattended, it reaches [read area at +24h] hectares in a day."

[Slider at +0 h → "Plan response". Toggle No action / With plan.]

"A commander decides now. The simulation places a control line where the front will be in three hours, the time a crew needs to cut it, and re-runs the fire. [read: X ha instead of Y], with [N] hand crews. ai& writes the tactics: anchor point, line, helicopter drops, structure protection, crew safety."

[Slider to +6 h or later → "Re-plan". Click the P1 / P2 flags on the timeline.]

"Decide six hours later and the line is longer, needs more crews, and the fire ends bigger. Acting early is the whole game."

**1:35–2:35 — Replay: Ofunato 2025, Japan's largest fire in decades**

[Click "Replay · Ofunato". Days advance on the map; incidents turn grey as they go out.]

"This is the February 2025 Ofunato fire, replayed from NASA's archive over nine days, from ignition to the rain that put it out on March 5th."

[Open the incident → 3D prediction → slide to +120 h. Point at "Satellite check".]

"We seed the model with the first satellite pass and compare it with what the satellites saw later: [read: x/y real detections inside the prediction]."

[Back → "Fire graph · Neo4j". Click "Key spreading point", then "New fronts".]

"In Neo4j every detection is linked to the one it spread from. The graph shows the fire's main branch: 82 later detections descend from one point seen in the first hour. And two fronts appeared with no fire within two kilometres: jumps ahead of the front."

**2:35–3:00 — Why it matters**

"Jev finds the fire in milliseconds. The model predicts where it goes and tests a response plan. ai& turns it into a brief in Japanese and English. Neo4j remembers every site, every verdict and how each fire spread. A fire officer gets a plan, not a list of heat spots."

**Timing check:** about 480 spoken words, which is tight for 3:00. If short on time, cut the Live section (0:20–0:40) and start with Drill.

---

## 2. Judge tailoring (Round 1, one line each, suggestions only)

Judges from `docs/05`. Their interests are inferred, not confirmed.

- **ai& (Raj Kishan):** Lead with the strict-JSON report and the model split: vision escalation on `glm-5.3-flash`, text on `deepseek-v4-flash`. Say the model never writes numbers or times.
- **Microsoft (Drew Robbins):** Lead with the architecture: three layers, rules in code, and memory as an auditable trail of every verdict.
- **AlgoMori (Tan):** Lead with the multi-step agent: triage, then fan-out probe, then scoring, then report, then memory ("System 1 / System 2 / Memory").
- **CEO (Sasha Bogatirev):** Lead with the user (municipal disaster officers) and the value: the model runs only on alerts. Do not quote a price.

---

## 3. Likely judge questions

1. **Why not just use FIRMS confidence?**
   FIRMS gives a confidence class per hotspot. Our question is different: is there a plant within about 400 m? VIIRS geolocation is about 375 m, so the centre pixel often lands on water or forest next to a factory (the Tokushima and Kitakyushu cases in `docs/12`). We ask about the neighbourhood, not the pixel.

2. **What if there are clouds?**
   Stage 2 asks about cloud cover, and the report lists low confidence and the unknowns. **We have not measured how clouds affect detection.** Say so if asked.

3. **What does it cost per day?**
   Jev runs once per hotspot. Measured: 37 Jev calls for 48 replay hotspots. The ai& calls run only for alerts. Prices: Jev $0.042 per million input tokens, output free (`docs/08`); ai& `deepseek-v4-flash` $0.15 in / $0.25 out per million (`docs/03`). A whole day of testing cost a few cents.

4. **What about false negatives?**
   Stage 1 can miss a fire. Mitigations: low Jev confidence escalates to the vision model, and mixed areas get a deep probe (the spike case was confidence 0.40, escalated). **We have no measured miss rate.** Say so.

5. **Why a graph?**
   Two relational questions. First, memory: what do we already know within about 400 m of this point? Sites are agent-memory Location entities linked to their reasoning traces; the spike's second pass gave 100% memory hits and zero Jev calls. Second, propagation: every Ofunato detection is linked with `SPREAD_TO` to the nearest detection of an earlier satellite pass (≤ 2 km, ≤ 48 h). Root nodes, longest path, the hub with the most descendants and new fronts are Cypher queries on that graph, not hand-written analysis. Measured on Ofunato: 255 detections, 227 spread links, longest path 8 hops / 4.5 km / 119 h, one hub with 82 descendants, 2 new fronts (+49 h, +131 h).

8. **How do you know the spread prediction is right?**
   Replay seeds the model with the first satellite pass and checks later VIIRS detections against the predicted area (tolerance 2 cells, about 375 m). On Ofunato: about 48% of detections at +48 h and 85–96% at +120–168 h fall inside; total area is about 1.9× the real fire, so the model is cautious. It is a simple elliptical wind-slope model on a 180 m grid, not FARSITE.

9. **Is the response plan realistic?**
   The control line follows the fire's isochrone three hours after the decision (crew lead time), on the head and flanks, or the whole perimeter when the forecast has a wind shift of 60° or more. Crew counts use typical line production rates (hand crew 0.3 km/h, bulldozer 1 km/h). ai& writes the tactics only from those numbers. Roads and rivers are not in the model yet.

6. **Data sovereignty: where does the inference run?**
   The imagery and hotspot data are public (NASA FIRMS, GSI). ai& runs on its own GPUs in Japan, data stays in Japan (`docs/03`, from aiand.com). Where Jev / TypeSafe runs is unverified: do not claim a Japan-only pipeline.

7. **Is the demo live or recorded?**
   Live from the laptop, with a recorded backup. Answer this honestly if asked.

---

## 4. Submission form text

- **Team name:** [TEAM NAME]
- **Member names:** [MEMBER NAMES]
- **Member emails:** [MEMBER EMAILS]
- **Project name:** Wildfire Sentinel [confirm final name; "TBD" in `docs/12`]
- **Code repository URL:** https://github.com/juanmaagd/wildfire-sentinel

**Description (2–3 sentences):**

> Wildfire Sentinel watches NASA satellite hotspots over Japan, filters out the factories, and raises a fire alert in under a second from the aerial photo. It predicts the spread on real 3D terrain with the hourly forecast, lets a commander test a response plan (control line, crews, tactics written by ai&) at any hour, and replays the 2025 Ofunato fire against what the satellites actually saw. Neo4j remembers every site and verdict, and stores each fire as a propagation graph that shows how it spread.

**Which sponsor tool you used and how:**

> **ai&:** Situation reports through the OpenAI-compatible API (`api.aiand.com`). Vision escalation uses `zai-org/glm-5.3-flash`. Alert and report text uses `deepseek-ai/deepseek-v4-flash`. Output is strict JSON (`json_schema`). The model writes text only; all numbers and times come from code.
>
> **ai&** also writes the tactical response plan (anchor point, control line, aerial drops, structure protection, crew safety) from the simulation's numbers, on demand.
>
> **Neo4j:** Neo4j Agent Memory stores sites as Location entities and each verdict as a reasoning trace with its tool call; location memory skips known sites, so they never reach Jev. Each fire is also written as a propagation graph (`Detection -[:SPREAD_TO]-> Detection`, days, links to the memory sites) with plain Cypher, and its insights (ignition, longest path, key spreading point, new fronts) are Cypher queries rendered in the app with NVL.

---

## 5. Backup plan checklist

- [ ] **Record a screen video before 15:30.** Cover: Drill alert → 3D prediction → plan at +0 h and re-plan later (flags P1/P2) → Replay Ofunato → satellite check → Fire graph (key spreading point, new fronts).
- [ ] Screenshots: map with alerts, report JA, report EN, memory trace.
- [ ] Mock mode: `web/index.html?mock=1` if the network fails. (verified).
- [ ] Local Docker Neo4j is the default for now: the Aura URI is empty (`docs/10`). It works offline.
- [ ] Jev, ai&, and FIRMS need internet. If the network fails, use mock mode and the recording.
- [ ] Aura Free auto-pauses after 72 h of inactivity. Do not depend on it for the demo.
- [ ] Test the laptop and the HDMI adapter before the final (16:30, projector).
- [ ] Round 1 format: 3 min demo plus 1–2 min Q&A at your table.
- [ ] UI labels on the running page: "Live", "Drill · Ashikaga", "Replay · Ofunato".
- [ ] Run Replay once before the demo so Ofunato's memory sites exist (the fire graph links to them).
