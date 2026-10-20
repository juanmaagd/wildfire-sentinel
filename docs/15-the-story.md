# 15 — How to sell it

Read it, keep the feeling, say it your way.

---

## What it is (the product, not the tech)

# **Wildfire Sentinel — the AI wildfire alert for fire departments.**

**It tells a fire chief three things the moment a wildfire shows up: it's real, here's where it's going, and here's the plan to stop it.**

Taglines (pick one, use it at the start and at the end):
- **"From satellite to fire plan, in seconds."**
- **"Know first. See ahead. Stop it early."**
- **"Your wildfire co-pilot."**

---

## Open with the product (first 10 seconds)

With the app already on screen:

> **"This is Wildfire Sentinel. It's an AI that watches every wildfire signal in Japan, tells a fire chief which one is real, shows where it's going, and hands them the plan to stop it. In seconds."**

Then: *"Let me show you."* → click **Drill · Ashikaga**.

Notice the hook already contains the whole demo, in order: **which one is real** (the alert) → **where it's going** (3D prediction) → **the plan to stop it** (response plan). Just follow it.

---

## Who it's for

**Fire departments and municipal disaster offices in Japan** (消防本部 / 防災課).
The people who, at 2 a.m., have to decide: do we send crews? where? how many? do we evacuate?

Today they decide with phone calls, a paper map and experience. We give them **a co-pilot**.

---

## The three promises (this is the product)

### 🔥 1. Know first — "Is it a real fire?"
Satellites see dozens of heat spots in Japan every day. **Most are steel mills and factories.**
Wildfire Sentinel checks every single one against the aerial photo and **only alerts when it's a real fire risk**.
**Alert in under a second. No noise.**

### 🗺️ 2. See ahead — "Where is it going?"
One tap and the chief sees the fire **grow on real 3D terrain**, hour by hour, with **tomorrow's actual wind and rain**.
Where it'll be in 3 hours. In 24. Which neighbourhood is in the way. When the rain will save us.

### 🚒 3. Stop it early — "What do we do?"
Tap **"Plan"** and the system tells you **where to cut the firebreak, how many crews you need, and how much fire you'll save**.
Plus a ready-to-send **tactical brief in Japanese and English**.
Try "act now" vs "act in 6 hours" and **see the difference before you send anyone**.

---

## The killer line

> **"Act early and the fire stays small. Act late and it doesn't. Wildfire Sentinel shows you that before it happens."**

---

## Proof it works (real fire, real numbers)

We replayed the Ofunato fire with real NASA data.
- **We tested the model on 18 real fires in 9 countries.** On the 6 it never saw, it finds **67%** of where the satellite saw the fire go in the first 30 hours (our first model: 33%).
- **It adapts to each place:** fuel dries with heat and dry air and gets wet with rain, hour by hour; fire runs uphill; farmland, towns and lakes slow or stop it.
- **Our prediction is "nobody fights it".** At Ofunato it predicted 3,800 to 4,200 hectares at 30 hours; the real fire, with hundreds of firefighters on it, burned 1,200. That gap is what they saved. And it's exactly what our plan tool helps you win faster.

And Neo4j lets us show **the family tree of the fire**: one single point in the first hour gave birth to **82 more**. Catch that one early, and you cut the main branch.

---

## Why now

- Wildfires in Japan are **getting bigger**: Ofunato 2025 was the worst in 50 years.
- Satellite data is **free**. AI is **fast and cheap**. Nobody has put it **in the fire chief's hands**.
- **Made for Japan:** Japanese briefs, Japanese aerial photos, AI running **in Japan** (ai&).

---

## Under the hood (only if they ask, one breath each)

- **NASA satellites** see the heat.
- **Jev** looks at the aerial photo: factory or forest? 0.2 seconds.
- **Our model** simulates the fire on real terrain with real weather.
- **ai&** (Japanese AI) writes the plan and the brief.
- **Neo4j** is the memory: every place, every decision, and how each fire spread.

---

## The numbers to drop

| | |
| --- | --- |
| **< 1 sec** | heat spot → fire alert |
| **~150 → ~20** | today's heat spots in Japan → the ones worth a look |
| **18** | real fires in 9 countries the model was tested on |
| **67%** | of the fire's first 30 h found on fires the model never saw (first model: 33%) |
| **82** | detections that grew from one single early point |
| **3 h** | lead time we give crews to cut the firebreak |

---

## Demo (2 minutes, let it breathe)

1. **Drill · Ashikaga** → *"An alert just came in."* → open it.
2. **3D prediction** → press play → *"This is where it goes if nobody acts."*
3. **Plan now** → toggle *With plan* → *"Here's the firebreak, two crews, fire stays small."*
4. Move to +6 h → **Re-plan** → *"Same fire, six hours late: longer line, more crews, bigger fire."*
5. **Replay · Ofunato** → open it → *"A real fire: this is what it does if nobody fights it. The gap to the official dots is what firefighters saved."*
6. **Fire graph** → *Key spreading point* → *"One early point, 82 more fires. That's the one to stop."*

---

## Tough questions → confident answers

**"Is it really early warning?"**
"It alerts every time the satellite passes, about six times a day, and filters the noise. The next step is Japan's Himawari satellite, every 10 minutes, as the trigger in front of the same system."

**"How do you know the prediction is good?"**
"We measured it on 18 real fires in 9 countries against what the satellite saw burning. On the 6 it never saw, it finds 67% of the fire in the first 30 hours. It predicts the 'nobody fights it' scenario on purpose, which is exactly what you plan against."

**"Who pays?"**
"Prefectures and municipalities, per region. The data is free and the AI is cheap, so it's affordable even for small towns."

**"What's next?"**
"Himawari for faster alerts, maps of roads and towns in the model, and a pilot with one fire department."

---

## Close

> **"Satellites see heat. Wildfire Sentinel turns it into a plan. From satellite to fire plan, in seconds."**
