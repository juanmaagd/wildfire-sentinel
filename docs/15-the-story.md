# 15 — The story (read this, then tell it your way)

Not a script. Read it once or twice, keep the five numbers in your head, and talk.

---

## The one-liner

**Wildfire Sentinel turns satellite heat spots into a decision: is it a real fire, where will it go, and what should we do about it.**

If you only say one thing, say that.

---

## The problem (say it like a story)

Every day, NASA satellites see dozens of heat spots across Japan. Almost all of them are **not fires**: they are steel mills, refineries, factories. They're hot every single day.

So when a real wildfire starts, it's buried in that noise. And a fire officer can't check every dot by hand.

And the first hours decide everything. In February 2025, the Ofunato fire in Iwate became **Japan's largest wildfire in over 50 years**: about 3,000 hectares, one death, hundreds of buildings, thousands evacuated.

---

## What we built (three moments)

### 1. "Is it real?" — the alert
For every heat spot, the system looks at the **aerial photo of that exact place** and asks simple questions: is there a factory nearby? forest? houses? water?
- Factory → ignored.
- Forest, no factory → **fire alert, in under a second.**
- It **remembers** every place it has judged (Neo4j). A known factory never costs another check.

**Today's real data:** about 150 heat spots in Japan; most were factories and got filtered out, ~20 became alerts worth a look.

### 2. "Where will it go?" — the prediction
For an alert, we simulate the fire on the **real 3D terrain**, with the **real hourly weather** for the next 7 days: wind, humidity, rain. Fire runs faster uphill and with the wind; rain stops it; the sea doesn't burn.

You drag a slider and **watch the fire grow** hour by hour, with the weather right below it.

### 3. "What do we do?" — the response plan
This is the part firefighters care about. You don't fight a wildfire with a hose: you **cut a firebreak** where the fire will be in a few hours, with enough crews to finish it in time.

You pick a moment ("let's decide now" or "six hours from now"), and the system:
- draws the **control line** where the front will be 3 hours later,
- tells you **how many crews** you need,
- re-runs the fire **with** that line, so you see the difference,
- and an AI (ai&) writes the **tactical plan** in Japanese and English: where to anchor, where to attack, when to bring helicopters, how to keep crews safe.

**The message:** decide early → short line, few crews, small fire. Decide late → longer line, more crews, bigger fire. You can compare both on the timeline.

---

## The proof (Ofunato, real data)

We replay the Ofunato fire, day by day, from NASA's archive.

- We start the prediction from the **first time the satellite saw it**.
- **30 hours later, we predicted ~1,140 hectares. The official number was 1,200.** That's a 5% difference.
- After that, the real fire stayed smaller than our curve. That makes sense: **our model shows the fire with nobody fighting it**, and in reality hundreds of firefighters and helicopters were working. The gap is, in large part, what they saved.

And in the graph view: every satellite detection is linked to the one it most likely spread from. You can literally see the **family tree of the fire**:
- one point from the first hour is the "parent" of **82 later detections**: that was the main branch;
- **two new fronts** jumped more than 2 km ahead: embers starting new fires.

---

## Why it matters (the "so what")

- **Less noise:** officers stop looking at factories.
- **Earlier decisions:** see where it's going before it gets there.
- **Better plans:** test a strategy before sending crews.
- **Japanese-ready:** every brief is in Japanese and English.
- **Remote areas:** places where nobody calls 119 in time.

---

## The five numbers to remember

| Number | What it means |
| --- | --- |
| **< 1 second** | from heat spot to fire alert |
| **~150 → ~20** | today's heat spots in Japan vs. the ones worth a look |
| **1,140 vs 1,200 ha** | our Ofunato prediction at 30 h vs. the official figure |
| **82** | detections that grew from one single point (the main branch) |
| **3 hours** | the lead time we give crews to cut the control line |

---

## The sponsors, in one breath each

- **ai&** (Japanese AI, runs in Japan): writes the situation report and the tactical plan, in Japanese and English. The AI writes words; the numbers always come from our code.
- **Neo4j** (graph database): it's the system's **memory** (every place, every decision, and why) and it stores each fire as a **graph of how it spread**.
- **Jev** (very fast image AI, not a sponsor): the "is it a factory or a forest?" check, in about 0.2 seconds.

---

## Demo path (what to click)

1. **Live** → "these are today's real heat spots; most are factories, filtered out."
2. **Drill · Ashikaga** → alert pops up → open it → **3D prediction** → press play.
3. Slider at the start → **Plan response** → toggle *No action / With plan* → move the slider later → **Re-plan** → click P1 / P2 to compare.
4. **Replay · Ofunato** → days roll by → open the fire → 3D → point at **Reality check** (1,140 vs 1,200).
5. **Fire graph** → click *Key spreading point*, then *New fronts*.

If time is short: skip Live, start at Drill.

---

## Questions you'll probably get (short answers)

**"Is this early warning? How often does the satellite look?"**
Honestly, not minute-level. These satellites pass over Japan about six times a day. 119 calls are faster for the first minutes. We triage every pass, track the fire and predict it. The next step is Japan's **Himawari** satellite, which images Japan every 10 minutes, as the early trigger in front of this same system.

**"How accurate is the prediction?"**
At 30 hours into Ofunato, within 5% of the official burned area. After that it shows the fire without firefighting, so it's bigger than reality. That's on purpose: it's the "what if nobody acts" scenario.

**"Isn't this just a nice map?"**
No: it answers three decisions. Is it real, where will it go, and where to put the firebreak and how many crews.

**"Why a graph database?"**
Because the questions are about connections: what do we already know near this point, and which fire point grew from which. Neo4j answers both.

**"What's not done yet?"**
The model doesn't know roads, rivers or which areas are towns. The spread model is simple and tuned on one fire. Next: land-use maps, Himawari, and testing on more fires.

**"Who would use it?"**
Municipal disaster offices and fire departments: the people who have to decide where to send crews and when to evacuate.

---

## Closing line (pick one)

- *"Satellites see heat. We turn it into a decision."*
- *"From a dot on a map to a plan for the crews."*
- *"Find it in a second, see where it goes, decide before it gets there."*
