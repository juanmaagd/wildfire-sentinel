# 03 — Sponsor: ai& Inference

## What it is

Sovereign AI inference API running on GPUs **in Japan**. Serves open-weight models (DeepSeek, Kimi, GLM, Qwen, Gemma, gpt-oss…) through **OpenAI- and Anthropic-compatible** APIs. Input/output data stays in Japan and is not used for training.

Pitch angle they care about: **data sovereignty for Japanese companies** + cheap, fast open models.

## Full product catalog

ai& sells itself as "the only sovereign AI stack built end-to-end in Japan": up to 80% cheaper than OpenAI/Anthropic, <50 ms latency in Japan, zero cross-border data egress, APPI-aligned.

| Product | What it is | Usable today? |
| --- | --- | --- |
| **Inference API** | Open-weight LLMs via OpenAI/Anthropic-compatible API (chat, responses, messages) | ✅ Core of the hackathon credits |
| **Vision / documents / video understanding** | Send images, PDFs, video clips by `file_id` or URL | ✅ On multimodal models |
| **Video generation** | `minimaxai/minimax-h3`, text/image/reference → MP4 with audio, 768p, 4–30 s, async jobs, runs in Japan | ✅ but must accept Video Terms in the console first; takes minutes per clip |
| **Files / Uploads API** | Upload assets up to 100 MiB (chunked beyond) | ✅ |
| **ai& CLI** (`npm i -g @aiand/cli`) | Login, `aiand run`, `aiand chat`, models, logs, usage; runs OpenCode / Claude Code / Codex on ai& | ✅ Handy for dev, not a product feature |
| **Analytics API** | Per-request logs, metrics, cost per request | ✅ Could power a "cost/latency" panel in the demo |
| **Build (app hosting)** | "Vibe code to vibe deploy": deploy apps/APIs in Japan (tokyo-west) next to the model, private JP DB | ❓ Marketing only, no public docs; ask the ai& team |
| **Post-training** | Domain/Japanese-language fine-tuning of open models | ❌ Enterprise service, not for a one-day build |
| **Own GPU infrastructure** | 100 MW+ capacity in development | Context for the pitch |

**Narrative they want to hear:** Japanese data stays in Japan, open models are good enough and cheaper, one-line migration.

## Quick start

- Base URL: `https://api.aiand.com/v1` (OpenAI SDK) — Anthropic Messages also supported.
- Auth: `Authorization: Bearer sk-...`
- Console: https://console.aiand.com

```python
from openai import OpenAI
client = OpenAI(base_url="https://api.aiand.com/v1", api_key="sk-...")
r = client.chat.completions.create(
    model="deepseek-ai/deepseek-v4-flash",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(r.choices[0].message.content)
```

## Getting the hackathon credits

Event **redemption code** (ask in Discord "sponsor credit support" or the ai& team in the room):

1. https://console.aiand.com/settings/billing → "Redeem a Code" → Apply.
2. One redemption per person **and** per organization; only org admins can redeem.
3. Event codes often expire the same day. Credits themselves never expire.

## Models available today (`GET /v1/models`, prices USD per 1M tokens)

| Model ID | Capabilities | Context | In / Out |
| --- | --- | --- | --- |
| `deepseek-ai/deepseek-v4-flash` | reasoning, tools | 1M | 0.15 / 0.25 |
| `zai-org/glm-5.3-flash` | reasoning, tools, vision, video, document | 1M | 0.15 / 0.50 |
| `google/gemma-4-31b-it` | reasoning, tools, vision, video, document | 256K | 0.20 / 0.50 |
| `deepseek-ai/deepseek-v4.1-flash` | reasoning, tools, vision, document | 1M | 0.30 / 0.60 |
| `openai/gpt-oss-120b` | reasoning, tools | 128K | 0.15 / 0.60 |
| `motif-technologies/motif-3` | reasoning, tools | 256K | 0.50 / 2.00 |
| `deepseek-ai/deepseek-v4-pro` | reasoning, tools | 1M | 1.00 / 2.50 |
| `qwen/qwen3.8-27b` | reasoning, tools, vision, video, document | 256K | 0.40 / 3.00 |
| `qwen/qwen3.6-27b` | reasoning, tools, vision, video, document | 256K | 0.32 / 3.20 |
| `moonshotai/kimi-k2.7-code` | reasoning, tools, vision, document | 256K | 0.75 / 3.50 |
| `zai-org/glm-5.3` | reasoning, tools | 1M | 1.00 / 4.00 |
| `zai-org/glm-5.2` | reasoning, tools | 1M | 1.00 / 4.00 |
| `moonshotai/kimi-k3` | reasoning, tools, vision, document | 1M | 3.00 / 12.50 |

The list is dynamic; re-check with `curl https://api.aiand.com/v1/models`.

**Default picks:**
- Text / agents / extraction: `deepseek-v4-flash` (cheapest, 1M context, tools + reasoning; reasoning can be set to `none` for speed).
- Vision / PDFs / video: `glm-5.3-flash` or `qwen3.8-27b`.
- Hardest reasoning step only: `kimi-k3` or `deepseek-v4-pro`.
- `model: "auto"` lets ai& pick per request.

## Capabilities worth using

- **Structured outputs** (JSON Schema) — https://docs.aiand.com/capabilities/structured-outputs/
- **Tool calling** — https://docs.aiand.com/capabilities/tool-calling/
- **Vision, video, documents** via Files API (`file_id`) — https://docs.aiand.com/capabilities/vision/
- **Video generation** (async jobs) — https://docs.aiand.com/api/videos/
- Streaming (SSE), per-request cost headers.

Cookbooks: structured extraction, RAG, streaming chat UI (Next.js), tool-calling agent, vision extraction (receipt → line items).
Framework integrations: LangChain/LangGraph, LlamaIndex, CrewAI, PydanticAI, OpenAI Agents SDK, Vercel AI SDK.

## ⚠️ Gotchas

- **No embeddings endpoint.** ai& serves generation only. For vectors (e.g. Neo4j vector index) use local embeddings (`sentence-transformers`, Ollama) — the official RAG cookbook does exactly this. Or skip vectors: with 1M-context models, "stuff the corpus in context" is viable for a demo.
- Using ai& as the backend for Claude Code / Cursor / OpenCode is a nice way to code on credits, but **it does not count as "using the sponsor tool" in the product**. The product itself must call ai&.
- Judge Raj Kishan works at ai&: they will notice whether ai& is load-bearing or decorative.
