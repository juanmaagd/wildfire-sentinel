# 04 — Sponsor: Neo4j

## What it is

Graph database. The sponsor framing today: **"memory and retrieval for AI agents"** — what your app or agent stores, connects and remembers. Free credits (Neo4j Aura) and on-site support for every team that wants them (Discord "sponsor credit support" or the Neo4j team in the room).

Why a graph instead of a vector store: relationships are first-class, so an agent can answer multi-hop questions ("who worked with whom on what"), explain *why* it retrieved something, and keep long-term memory that is inspectable and visual. That visual graph is great demo material.

## Full product catalog ("Graph Intelligence Platform")

| Product | What it is | Hackathon relevance |
| --- | --- | --- |
| **AuraDB** (cloud) | Managed graph DB. Free tier ($0, no card, node/relationship limits, auto-pause) and Professional (from $0.09/GB/h) | ✅ Sponsor credits likely cover Professional |
| **Aura Agent** | **No/low-code GraphRAG agent builder** inside Aura. "Create with AI" generates the agent from your schema. Tools: Cypher Template, Similarity Search, Text2Cypher. Publish as **REST API or MCP server**. Has evaluation datasets. Included even in Free | ✅ Fastest way to a working agent over a graph |
| **Graph Analytics (GDS)** | 65+ graph algorithms: PageRank, community detection, shortest path, similarity, link prediction | ✅ On Professional (not Free) or local Docker plugin. Great "technically impressive" lever |
| **Vector index & search** | Native vector index for semantic search, combinable with graph traversal | ✅ Needs embeddings (not from ai&) |
| **Bloom / Explore** | Visual graph exploration (Bloom Basic on Free) | ✅ The demo visual |
| **Dashboards** | Built-in dashboards over the graph | ✅ Quick UI without frontend work |
| **Data Importer** | CSV → graph with a visual mapper | ✅ Seed demo data fast |
| **Query API (HTTP)** & **GraphQL Library** | Query the DB over HTTP or expose it as GraphQL | ✅ Frontend can talk to Neo4j without a backend driver |
| **LLM Knowledge Graph Builder** | Web app: PDFs/web/YouTube → knowledge graph | ✅ Seeding data in minutes |
| **MCP servers** (official + Labs) | Schema, Cypher read/write, memory graph, data modeling, Aura management | ✅ Plug Neo4j into any agent |
| **Self-managed** (Community/Enterprise, Docker, Desktop) | Run locally | ✅ Offline fallback |

### ⚠️ Aura Agent gotchas

- **Agents run in Belgium (GCP europe-west1).** That contradicts the ai& "data stays in Japan" story. If the pitch is sovereignty, don't make Aura Agent the core.
- It uses **Neo4j's own curated LLMs**, not ai&. Using it alone means ai& is not the brain. A strong combo: publish the Aura Agent as an **MCP server** and let an ai& model call it as a tool.
- Read-only queries only. No conversation history stored.
- Similarity Search only supports embeddings from OpenAI (Azure) or Vertex AI.
- Needs "Generative AI assistance" + "Aura Agent" enabled in org settings, and tool authentication on the project.
- Internal agents are free; external (API/MCP) endpoints are billed (credits should cover it).

## Three fast paths (from least to most code)

### A. MCP servers (near-zero Cypher)

- **Official `neo4j/mcp`** — https://github.com/neo4j/mcp — get schema, read/write Cypher, run graph algorithms (GDS). stdio and HTTP. Works with Aura, Docker, Desktop.
- **Labs `mcp-neo4j-memory`** — https://github.com/neo4j-contrib/mcp-neo4j/tree/main/servers/mcp-neo4j-memory — a ready-made knowledge-graph memory (entities, relations, observations) for an agent.
- Labs also: `mcp-neo4j-cypher`, `mcp-neo4j-data-modeling`, Aura manager.

### B. `neo4j-graphrag` Python package

https://neo4j.com/labs/genai-ecosystem/graphrag-python/

- `SimpleKGPipeline`: text/PDF → LLM extracts entities + relationships → graph in Neo4j.
- Retrievers: `VectorRetriever`, `VectorCypherRetriever` (vector hit, then walk 1–2 hops), Text2Cypher.
- Its `OpenAILLM` should accept a custom `base_url` → point at ai& (verify early).
- Needs an **embedder**: ai& has none → use a local `sentence-transformers` embedder.

### C. Framework integration

LangChain / LangGraph, LlamaIndex, PydanticAI, OpenAI Agents SDK, CrewAI, Claude Agent SDK, Google ADK all have Neo4j integrations — https://neo4j.com/labs/genai-ecosystem/

Also: **LLM Knowledge Graph Builder** (web tool: docs → graph) — https://neo4j.com/labs/genai-ecosystem/llm-graph-builder/ — handy for seeding data fast.

## Where to run it

| Option | Pros | Cons |
| --- | --- | --- |
| **Aura** (cloud, sponsor credits) | Zero setup, built-in browser/visualization, sponsor-visible | Depends on venue Wi-Fi |
| **Docker local** (`neo4j:5`) | Works offline, fast | Setup time, battery/CPU |

Decide when the idea is chosen. Either way, the Neo4j Browser / Bloom graph view is a strong visual for the demo.

## How to make Neo4j load-bearing (not decorative)

- The agent **reads and writes** the graph as memory during the demo (show it growing).
- Answers that need **multi-hop relationships** a plain vector search would miss.
- Show the **path/explanation** behind an answer.
