# 06 — Strategy

## What wins here

1. **One core user journey**, demoable in 3 minutes at a table, from our own laptop. Everything else is cut.
2. **Real, specific problem with a named user** ("a Tokyo restaurant owner who…", not "businesses").
3. **Both sponsors used meaningfully**: ai& as the brain, Neo4j as the memory. One is mandatory; both, done well, signals "technically impressive" to two of the four judges directly.
4. **Visible AI value**: the demo must show something that would be slow/impossible without AI.
5. **A surprising twist** for the "creative" point.

## Solo constraints (decided: building solo, ~5 h of real build time)

- **One flow, one screen.** No auth, no settings, no multi-page app.
- Lean on no-code surfaces for the "boring" parts: Neo4j Bloom/Dashboards or Aura Agent instead of a custom frontend when possible; a minimal UI (Streamlit/Gradio or a single HTML page) for the rest.
- ai& does the reasoning, Neo4j does the memory. Don't build infrastructure that isn't on the demo path.
- Matchmaking at 10:30 is still an option if a teammate with complementary skills (frontend/design) shows up.

## Time plan (deadline 16:00)

| Window | Goal |
| --- | --- |
| 10:30–11:00 | Lock idea, sketch the one flow, get API keys + credits, hello-world for ai& and Neo4j |
| 11:00–12:30 | Core flow end-to-end, ugly but working |
| 12:30–13:00 | Lunch (keep it short) |
| 13:00–15:00 | Make the demo path solid, seed demo data, minimal UI polish |
| 15:00–15:30 | **Feature freeze.** Record backup video, write README, push public repo |
| 15:30–15:50 | Rehearse the 3-minute pitch twice |
| 15:50 | **Submit** (don't wait until 16:00) |

## Risk control

- Wi-Fi will be crowded: phone tethering, and consider local Neo4j (Docker) or cached model responses for the demo path.
- Fragile demo → backup recording + screenshots.
- Pre-seed demo data; never depend on live typing of long inputs.
- Use the cheap fast model (`deepseek-v4-flash`) by default so latency doesn't kill the demo.
- Power: keep the laptop charged; the demo runs from it.

## Pitch skeleton (3 min)

- 0:00–0:30 Problem + who suffers it
- 0:30–2:15 Live demo of the one flow
- 2:15–2:45 How it works (ai& model + Neo4j graph, one sentence each)
- 2:45–3:00 Why it matters / what's next
