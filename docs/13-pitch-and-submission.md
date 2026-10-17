# 13 — Pitch and submission (Wildfire Sentinel)

Written 2026-10-17 for the 16:00 JST deadline. Sources: `docs/02`, `docs/05`, `docs/10`, `docs/12`, `odd/tasks/wildfire-sentinel.md`.
Verified by the parent against measured data: 77% = 55 of 71 live sites; Ofunato 2025-02-26 14:00 JST gusts 24.7 m/s (Open-Meteo archive); stage-2 probe 190–530 ms for 11 questions on 3 images; mock mode `?mock=1`. Only Jev/TypeSafe hosting location remains unverified.

---

## 1. Pitch script (3:00)

Spoken lines are plain text. Stage directions are in [brackets].

**0:00–0:25 — Problem**

"NASA's VIIRS satellite flagged 155 heat detections across Japan in just two days. Most of them sit on steel mills and factories. The one that matters, a real wildfire, is buried in the noise, and a municipal disaster officer cannot check each one by hand."

[Show: Live · today map with hotspots on screen.]

**0:25–0:50 — Solution**

"Wildfire Sentinel works in three layers. Jev, a triage model, checks every hotspot in about 200 milliseconds and raises the alert the moment a possible fire appears. ai& then writes the situation report: urgency, danger, spread risk, exposure, and a Japanese and English brief. Neo4j Agent Memory remembers every site and verdict, so known factories are skipped next time."

**0:50–1:10 — Live demo: filtering**

[Click "Live · today". Point at the filtered counter and the colored hotspots.]

"These are today's real hotspots. Known industrial sites are filtered out in seconds, with no model call."

[Measured: 55 of 71 Japanese sites on 2026-10-17 were industrial (77%).]

**1:10–2:20 — Live demo: Ofunato replay**

[Click "Replay · Ofunato 2025". Wait for the first alert on the map.]

"This is the February 2025 Ofunato fire, replayed from NASA's archive for 26 February to 1 March. Jev raised the alert on day one, before any report existed."

[Click the top alert. The report opens.]

"Once an alert is raised, Jev takes a closer look: three images, the close view, the wide view and the satellite view, and about ten questions run in parallel. The answers go into code. Code combines them with real weather, wind and humidity, into urgency, danger, spread risk and exposure. The model never writes a number or a time."

[Toggle JA / EN.]

"ai& writes the situation report and the brief, in Japanese and English, from those facts."

"The full replay: 48 hotspots, 37 Jev calls, three to four ai& reports, about 23 seconds."

**2:20–2:45 — Memory**

[Point at the memory trace panel.]

"Neo4j stores the site, every verdict as a reasoning trace, and the detection history. Run the same area a second time and memory answers every site, with zero Jev calls."

**2:45–3:00 — Why it matters**

"Jev finds the possible fire in milliseconds. The analyst explains it in seconds. Memory makes each pass cheaper and smarter. A municipal officer gets a brief they can act on, not a list of heat spots."

[End on the report, EN or JA.]

**Timing check:** about 430 spoken words. At a normal pace, that is about 2:50, before the stage directions.

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
   The questions we ask are relational: what do we already know within about 400 m of this point, and how did this fire's detections change over days? Each site links to its verdicts and its detection history. The spike's second pass gave 100% memory hits and zero Jev calls.

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
- **Code repository URL:** [REPO URL: public, or invite the organizers]

**Description (2–3 sentences):**

> Wildfire Sentinel watches NASA satellite hotspots over Japan and separates real fire risk from the steel mills and factories around them. Jev triages every hotspot in about 0.2 seconds and raises an alert immediately; ai& then writes a grounded situation report and a Japanese and English brief for municipal disaster officers. Neo4j Agent Memory remembers every site and verdict, so known industrial sites are skipped on the next pass.

**Which sponsor tool you used and how:**

> **ai&:** Situation reports through the OpenAI-compatible API (`api.aiand.com`). Vision escalation uses `zai-org/glm-5.3-flash`. Alert and report text uses `deepseek-ai/deepseek-v4-flash`. Output is strict JSON (`json_schema`). The model writes text only; all numbers and times come from code.
>
> **Neo4j:** Neo4j Agent Memory stores sites, each verdict as a reasoning trace, and the detection history. Location memory skips known industrial sites, so they never reach Jev.

---

## 5. Backup plan checklist

- [ ] **Record a screen video of the replay before 15:30.** Cover: Replay, first alert, report, JA/EN toggle. The task file still lists the backup recording as `todo` (T8).
- [ ] Screenshots: map with alerts, report JA, report EN, memory trace.
- [ ] Mock mode: `web/index.html?mock=1` if the network fails. (verified).
- [ ] Local Docker Neo4j is the default for now: the Aura URI is empty (`docs/10`). It works offline.
- [ ] Jev, ai&, and FIRMS need internet. If the network fails, use mock mode and the recording.
- [ ] Aura Free auto-pauses after 72 h of inactivity. Do not depend on it for the demo.
- [ ] Test the laptop and the HDMI adapter before the final (16:30, projector).
- [ ] Round 1 format: 3 min demo plus 1–2 min Q&A at your table.
- [ ] Verify the two UI labels ("Replay · Ofunato 2025", "Live · today") against the running page before rehearsal.
