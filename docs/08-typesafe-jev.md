# 08 — TypeSafe Jev (non-sponsor tool)

⚠️ **TypeSafe is not a sponsor.** It can be used, but the project must still use ai& and/or Neo4j in a load-bearing way.

Docs: https://docs.typesafe.ai (index: https://docs.typesafe.ai/llms.txt) · Console / keys: https://console.typesafe.ai/keys · Playground: https://console.typesafe.ai/playground

## What it is

Jev is a **"System One" model**: it does not generate text. You send a **state** (text, JSON, images) plus typed **questions**, and get back typed answers with **probabilities** and **confidence** that code can branch on directly.

- **~150 ms** decisions ("faster than human perception"; fast enough to play games or live in a UI).
- **$0.042 per million input tokens**, output free (~100x cheaper than LLM calls).
- All questions in one request run **in parallel and in isolation**: adding questions barely changes latency.
- Same weights for everyone; you customize through state, instructions and criteria, not fine-tuning.

## Primitives

| Type | Answers | Returns |
| --- | --- | --- |
| **Choice** | Pick one option from a set | `choice`, `probabilities`, `confidence` |
| **Score** | Position on ordered, described levels | `score`, `probabilities`, `confidence` |
| **Noul** | Is this statement true? | `noul` probability 0–1 |
| **Box** | Where is X in the image? | `top/bottom/left/right` as fractions + `confidence` |

## Models

| | Jev 1.14 (`jev-preview`) | Jev 1.13 (`jev-latest`) |
| --- | --- | --- |
| Released | 14 Oct 2026 | stable |
| Images | ✅ | ✅ |
| Box | ✅ (only 1.14) | ❌ |
| Context | 64k per request / 32k per question (262k with `TypeSafe-Danger-Zone-Long-Context: true`) | same |

## Images ("Dreamer-ready", i.e. beta)

- Requires header **`TypeSafe-Danger-Zone-Images: true`** on every request with an image or Box question.
- Images can go in the state, inside a question's instructions, or as Choice criteria (e.g. "is the person in `door` the same as in this picture?").
- Multipart upload preferred; 32 MiB request body limit. SDKs handle references automatically.
- No audio/video input: **sample video into frames** and send frames as images.
- Accuracy and format may change between releases; validate on our own images.

## Quick start (Python)

```python
from pathlib import Path
from typesafe_sdk import Choice, Image, Noul, TypeSafeClient  # pip install typesafe-sdk

with TypeSafeClient() as client:  # reads TYPESAFE_API_KEY
    result = client.system_one(
        state={"frame": Image(Path("frame.jpg"))},
        questions={
            "person_present": Noul(instructions="Is there a person in `frame`?"),
            "activity": Choice(
                instructions="What is the person in `frame` doing?",
                criteria={"working": "...", "idle": "...", "unsafe": "..."},
            ),
        },
        extra_headers={"TypeSafe-Danger-Zone-Images": "true"},
    )
```

JS: `npm install @typesafe-ai/sdk`. Keep the API key server-side.

## Patterns that fit a hackathon

- **Confidence-gated routing**: Jev decides fast; low confidence → escalate to an ai& reasoning model or a human.
- **Speculative fan-out**: ask many questions about the same frame at once; code uses the relevant ones.
- **Composite scoring**: atomic Scores combined with weights in code (tunable live in the UI).
- **Guardrails / verification**: check LLM inputs, outputs, citations, tool calls.
- **Simple memory**: Jev decides what is worth remembering (cookbook `basic_memory`).
- **Knowledge-graph entity alignment**: decide if two records are the same entity (cookbook `entity_alignment`).

## How Jev fits with the sponsors

The natural architecture is **System 1 / System 2 / Memory**:

| Layer | Tool | Role |
| --- | --- | --- |
| Perception, fast judgments | **Jev** | Per frame / per event: Noul, Choice, Score, Box in ~150 ms |
| Reasoning, language | **ai&** (e.g. `deepseek-v4-flash`, `kimi-k3`) | Only when Jev's confidence is low or a summary/explanation/report is needed |
| Memory | **Neo4j** | Store observed events, entities and relationships over time; query patterns across them |

Pitch line: "Jev is the reflex, ai& is the thinking, Neo4j is the memory." Each sponsor is load-bearing, and Jev provides the real-time "wow".

## Open questions to verify early

- Free credits or rate limits for a new TypeSafe account (check the console).
- End-to-end latency with images over venue Wi-Fi (measure, don't assume 150 ms).
- Where TypeSafe processes data (matters if the pitch is "data stays in Japan").
