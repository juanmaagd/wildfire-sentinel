# 11 — Neo4j Sponsor Brief & Our Plan

## The brief (from the Neo4j team)

> Goal: Build and experiment. Create a small AI application using Neo4j and try one or both of these products: Neo4j Aura Free, Neo4j Document Intelligence, Aura MCP, Neo4j Agent Memory Service.

Suggested flow: choose a use case → add documents or data → build a knowledge graph → ask connected questions → add agent memory if useful → short demo → **note what worked, what was confusing, and what blocked you.**

"A finished production application is not required. A working experiment and useful feedback are enough."

Resources: https://graphacademy.neo4j.com/ · https://neo4j.com/developer/ · https://neo4j.com/docs/ · https://community.neo4j.com/

## The four products (verified 2026-10-17)

| Product | What it is | Fit for wildfire triage |
| --- | --- | --- |
| **Aura Free** | Free managed graph DB (one per account, auto-pause after 72 h) | ✅ Our database |
| **Agent Memory** (`neo4j-agent-memory` 0.7.0, Labs; hosted = NAMS at memory.neo4jlabs.com) | Three memory layers in one graph: **short-term** (messages), **long-term** (POLE+O entities: Person, Organization, Location, Event, Object), **reasoning** (decision traces, tool-call provenance) | ⭐ **Core.** Every Jev triage verdict is a reasoning trace; hotspots, places and fire events are long-term entities. The agent checks past verdicts before re-judging a location ("Hirohata = steel mill, seen 12 times") |
| **Document Intelligence** (Aura console, preview, works on Free) | Documents → knowledge graph with an AI-generated model, no code | ➕ Optional: seed context from wildfire documents (past fire reports, evacuation plans) so alerts can cite history |
| **Aura MCP** | Hosted MCP server per Aura instance (HTTP) | ➕ Optional: let an ai& model query the graph as a tool |

### Agent Memory quick facts

- `pip install "neo4j-agent-memory[sentence-transformers]"` — Python ≥ 3.10, Neo4j ≥ 5.20. Labs project: experimental, community-supported.
- Canonical usage: `async with MemoryClient(MemorySettings(neo4j={...})) as memory:` then `memory.short_term`, `memory.long_term`, `memory.get_context(...)`, plus reasoning traces.
- ⚠️ **Embeddings:** ai& has no embeddings endpoint → use the `sentence-transformers` extra (local). LLM-based extraction may need a provider; check whether the `litellm`/`openai` extra accepts the ai& base URL.
- Docs: https://neo4j.com/labs/agent-memory/ · Repo: https://github.com/neo4j-labs/agent-memory · Examples: `examples/` in the repo.

## Spike: Agent Memory + Jev (`spike/memory_test.py`, local Docker Neo4j 5.26)

- Local Neo4j: `docker compose up -d` (repo root), user `neo4j` / `wildfire-local-dev`, Browser at http://localhost:7474. `.env` Neo4j values are used only when URI, username and password are all set.
- Settings: `embedding={"provider": "sentence_transformers", "model": "all-MiniLM-L6-v2", "dimensions": 384}`; geocoding/enrichment off.
- Flow per hotspot: `long_term.search_locations_near(lat, lon, radius_km=1.5)` → if known, reuse verdict (Jev skipped); else `reasoning.start_trace` → `add_step` → Jev → `record_tool_call("jev.triage", result=...)` → `long_term.add_entity(..., "LOCATION", coordinates=..., attributes=verdict)` → `complete_trace`.
- Result: pass 1 → 3 Jev calls + 3 memory hits (nearby detections of the same plant); pass 2 → 6/6 memory hits, 0 Jev calls.
- Graph: `ReasoningTrace -HAS_STEP-> ReasoningStep`, `ToolCall -INSTANCE_OF-> Tool`, `Entity:Location` with `SAME_AS` dedupe links.
- Gap: Location entities are not yet linked to their trace → pass `touched_entities` in `record_tool_call` or add an explicit relationship.

## Feedback log (required by the brief — fill in as we go)

| Time | Product | Worked / Confusing / Blocked | Note |
| --- | --- | --- | --- |
| 11:xx | Aura Free | Confusing | Sponsor credits guide link not easy to find; Free tier signup itself needs no code |
| 12:xx | Agent Memory | Worked | `search_locations_near` + reasoning traces with `record_tool_call` map perfectly to "remember past verdicts"; pass 2 skipped every model call |
| 12:xx | Agent Memory | Confusing | `MemorySettings.embedding`/`llm` are typed `Any`, so valid providers had to be discovered via `EmbeddingProvider` enum; `LLMConfig` has no `base_url`, so OpenAI-compatible providers (ai&) can't be plugged in directly |
| 12:xx | Agent Memory | Confusing | Startup logs warn about missing GLiNER/LLM extractors even when extraction isn't used |
| 13:xx | Agent Memory | Blocked → worked around | Concurrent `add_entity` calls deadlock in Neo4j (dedup locks); we serialize memory writes behind one lock |
| 13:xx | Agent Memory | Blocked → worked around | First run hung: the sentence-transformers model loads lazily from 8 concurrent calls; warm it up once at startup (and `HF_HUB_OFFLINE=1`) |
| 13:xx | Agent Memory | Confusing | No API to forget entities in an area; we use the driver with Cypher on `e.location` |
| 15:xx | Neo4j 5.26 Cypher | Worked | `CALL (b) { ... ORDER BY point.distance(...) LIMIT 1 }` builds every `SPREAD_TO` link of a fire in one query; `point.distance` also joins our graph to Agent Memory's Location entities |
| 15:xx | Agent Memory + own graph | Worked | Agent Memory and our propagation graph share one database, so a detection links straight to the site Jev judged (`SEEN_AT`) |
| 15:xx | NVL 2.0 (`@neo4j-nvl/react`) | Confusing | `layout` is no longer an `InteractiveNvlWrapper` prop (it goes in `nvlOptions`) and wheel zoom is `onZoomAndPan`, while several docs examples still show the old shape; the Vite production build with web-worker layout worked first time |
